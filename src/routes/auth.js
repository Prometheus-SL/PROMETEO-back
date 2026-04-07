const express = require('express');
const rateLimit = require('express-rate-limit');
const { randomBytes, randomUUID } = require('crypto');
const User = require('../models/User');
const Agent = require('../models/Agent');
const QRCodeModel = require('../models/QRCode');
const {
    authenticateToken,
    generateTokens,
    verifyRefreshToken,
} = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 10000000 : 5,
    message: {
        success: false,
        error: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: {
        success: false,
        error: 'Demasiados intentos de registro. Intenta de nuevo en 1 hora.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function getRequestMetadata(req) {
    return {
        userAgent: req.get('User-Agent') || null,
        ip: req.ip || req.connection?.remoteAddress || null,
    };
}

function serializeUser(user) {
    return {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
        name: user.name,
        surname: user.surname,
        birthday: user.birthday
    };
}

function serializeTokens(tokens) {
    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId: tokens.sessionId,
        expiresIn: null,
    };
}

function registerIssuedSession(user, tokens, req, options = {}) {
    const metadata = getRequestMetadata(req);

    user.registerSession({
        sessionId: tokens.sessionId,
        refreshToken: tokens.refreshToken,
        userAgent: metadata.userAgent,
        ip: metadata.ip,
    });

    if (options.updateLastLogin !== false) {
        user.lastLogin = new Date();
    }

    return user;
}

async function issueSessionTokens(user, req, options = {}) {
    const tokens = generateTokens(user, { sessionId: options.sessionId });
    registerIssuedSession(user, tokens, req, options);
    await user.save();
    return tokens;
}

async function findUserForLogin(identifier) {
    const normalizedIdentifier = normalizeText(identifier);
    if (!normalizedIdentifier) return null;

    return User.findOne({
        $or: [
            { username: normalizedIdentifier },
            { email: normalizeEmail(normalizedIdentifier) }
        ],
        isActive: true
    }).select('+password');
}

async function authenticateUserCredentials(identifier, password) {
    const user = await findUserForLogin(identifier);
    if (!user) {
        return null;
    }

    const isValidPassword = await user.matchPassword(password);
    return isValidPassword ? user : null;
}

async function findOrCreateAgentForUser(user, agentId) {
    let agent = await Agent.findOne({ agentId });

    if (!agent) {
        agent = new Agent({
            agentId,
            name: agentId,
            description: 'Agente registrado por autenticación',
            apiKey: randomBytes(32).toString('hex'),
            user: user._id,
            status: 'offline'
        });
        await agent.save();
        return agent;
    }

    if (!agent.user) {
        agent.user = user._id;
        await agent.save();
        return agent;
    }

    if (String(agent.user) !== String(user._id)) {
        return null;
    }

    return agent;
}

async function ensureQrIssuedTokens(qrCode, user, req) {
    if (qrCode.issuedTokens?.accessToken && qrCode.issuedTokens?.refreshToken && qrCode.issuedSessionId) {
        return qrCode.issuedTokens;
    }

    const tokens = generateTokens(user);
    registerIssuedSession(user, tokens, req);

    qrCode.issuedSessionId = tokens.sessionId;
    qrCode.issuedTokens = serializeTokens(tokens);

    await Promise.all([user.save(), qrCode.save()]);
    return qrCode.issuedTokens;
}

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const username = normalizeText(req.body?.username);
        const password = req.body?.password;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña son requeridos'
            });
        }

        const user = await authenticateUserCredentials(username, password);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        const tokens = await issueSessionTokens(user, req);

        res.json({
            success: true,
            data: {
                user: serializeUser(user),
                tokens: serializeTokens(tokens)
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.post('/agent/login', loginLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        const agentId = normalizeText(req.body?.agentId);

        if (!email || !password || !agentId) {
            return res.status(400).json({
                success: false,
                error: 'Email, contraseña y agentId son requeridos'
            });
        }

        const user = await User.findOne({ email, isActive: true }).select('+password');
        if (!user || !(await user.matchPassword(password))) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        const agent = await findOrCreateAgentForUser(user, agentId);
        if (!agent) {
            return res.status(403).json({
                success: false,
                error: 'Este agente ya está asociado a otro usuario'
            });
        }

        const tokens = await issueSessionTokens(user, req);

        return res.json({
            success: true,
            data: {
                user: serializeUser(user),
                agent: {
                    id: agent._id,
                    agentId: agent.agentId,
                    name: agent.name,
                    user: agent.user
                },
                tokens: serializeTokens(tokens)
            }
        });
    } catch (error) {
        console.error('Error en login de agente:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

router.post('/register', registerLimiter, async (req, res) => {
    try {
        const username = normalizeText(req.body?.username);
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        const name = normalizeText(req.body?.name);
        const surname = normalizeText(req.body?.surname);
        const birthday = req.body?.birthday;

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario, email y contraseña son requeridos'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        const existingUser = await User.findOne({
            $or: [{ username }, { email }]
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Usuario o email ya existe'
            });
        }

        const newUser = new User({
            username,
            email,
            password,
            role: 'user',
            name: name || undefined,
            surname: surname || undefined,
            birthday: birthday || undefined
        });

        await newUser.save();

        res.status(201).json({
            success: true,
            message: 'Usuario registrado exitosamente',
            data: {
                user: serializeUser(newUser)
            }
        });
    } catch (error) {
        console.error('Error en registro:', error);

        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                error: 'Error de validación',
                details: errors
            });
        }

        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.get('/me', authenticateToken, (req, res) => {
    res.json({
        success: true,
        data: {
            user: serializeUser(req.user),
            session: {
                sessionId: req.auth?.sessionId || null
            }
        }
    });
});

router.post('/refresh', verifyRefreshToken, async (req, res) => {
    try {
        const user = req.user;
        const sessionId = req.auth?.sessionId || randomUUID();

        user.removeSessionByRefreshToken(req.refreshToken);

        const tokens = generateTokens(user, { sessionId });
        registerIssuedSession(user, tokens, req, { updateLastLogin: false });
        await user.save();

        res.json({
            success: true,
            data: serializeTokens(tokens)
        });
    } catch (error) {
        console.error('Error en refresh:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const refreshToken = normalizeText(req.body?.refreshToken);
        const user = req.user;

        if (refreshToken) {
            user.removeSessionByRefreshToken(refreshToken);
        } else {
            user.revokeAllSessions();
        }

        await user.save();

        res.json({
            success: true,
            message: 'Sesión cerrada exitosamente'
        });
    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.get('/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Solo administradores pueden ver usuarios'
            });
        }

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const search = normalizeText(req.query.search);

        const query = search ? {
            $or: [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const users = await User.find(query)
            .select('-refreshTokens -tokenInvalidBefore')
            .limit(limit)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    current: page,
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.post('/qr/generate', async (req, res) => {
    try {
        const code = randomUUID();
        const qrCode = new QRCodeModel({
            code,
            deviceInfo: getRequestMetadata(req)
        });

        await qrCode.save();

        res.json({
            success: true,
            data: {
                code,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000)
            }
        });
    } catch (error) {
        console.error('Error generando código QR:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.get('/qr/status/:code', async (req, res) => {
    try {
        const code = normalizeText(req.params.code);
        const qrCode = await QRCodeModel.findOne({ code }).populate('userId', '-password -refreshTokens -tokenInvalidBefore');

        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'Código QR no encontrado o expirado'
            });
        }

        let tokens = qrCode.issuedTokens || {};

        if (qrCode.status === 'authenticated' && qrCode.userId && (!tokens.accessToken || !tokens.refreshToken)) {
            const user = await User.findOne({ _id: qrCode.userId._id, isActive: true });
            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: 'Usuario no encontrado o inactivo'
                });
            }

            tokens = await ensureQrIssuedTokens(qrCode, user, req);
        }

        res.json({
            success: true,
            data: {
                status: qrCode.status,
                scannedAt: qrCode.scannedAt,
                authenticatedAt: qrCode.authenticatedAt,
                user: qrCode.userId ? serializeUser(qrCode.userId) : null,
                tokens
            }
        });
    } catch (error) {
        console.error('Error verificando estado del QR:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.post('/qr/scan', async (req, res) => {
    try {
        const code = normalizeText(req.body?.code);

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Código QR requerido'
            });
        }

        const qrCode = await QRCodeModel.findOne({ code });

        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'Código QR no encontrado o expirado'
            });
        }

        if (qrCode.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: 'Código QR ya ha sido utilizado'
            });
        }

        qrCode.status = 'scanned';
        qrCode.scannedAt = new Date();
        await qrCode.save();

        res.json({
            success: true,
            message: 'Código QR escaneado correctamente'
        });
    } catch (error) {
        console.error('Error escaneando QR:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

router.post('/qr/authenticate', async (req, res) => {
    try {
        const code = normalizeText(req.body?.code);
        const username = normalizeText(req.body?.username);
        const password = req.body?.password;

        if (!code || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Código QR, usuario y contraseña son requeridos'
            });
        }

        const qrCode = await QRCodeModel.findOne({ code });

        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'Código QR no encontrado o expirado'
            });
        }

        if (qrCode.status !== 'scanned') {
            return res.status(400).json({
                success: false,
                error: 'Código QR no ha sido escaneado o ya ha sido utilizado'
            });
        }

        const user = await authenticateUserCredentials(username, password);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        qrCode.status = 'authenticated';
        qrCode.userId = user._id;
        qrCode.authenticatedAt = new Date();

        const tokens = await ensureQrIssuedTokens(qrCode, user, req);

        res.json({
            success: true,
            data: {
                user: serializeUser(user),
                tokens
            }
        });
    } catch (error) {
        console.error('Error autenticando con QR:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
