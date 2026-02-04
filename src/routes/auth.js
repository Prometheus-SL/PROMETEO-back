const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const QRCodeModel = require('../models/QRCode');
const {
    authenticateToken,
    generateTokens,
    verifyRefreshToken
} = require('../middleware/auth');

const router = express.Router();

// Rate limiting para login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: process.env.NODE_ENV === 'development' ? 10000000 : 5, // ilimitado en local (development), 5 en producción
    message: {
        success: false,
        error: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiting para registro
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 3, // máximo 3 registros por IP por hora
    message: {
        success: false,
        error: 'Demasiados intentos de registro. Intenta de nuevo en 1 hora.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validar datos de entrada
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña son requeridos'
            });
        }

        // Buscar usuario (incluir password para verificación)
        const user = await User.findOne({
            $or: [{ username }, { email: username }],
            isActive: true
        }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // Verificar contraseña
        const isValidPassword = await user.matchPassword(password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // Generar tokens
        const { accessToken, refreshToken } = generateTokens(user);

        // Guardar refresh token en la base de datos
        user.refreshTokens.push({
            token: refreshToken,
            createdAt: new Date()
        });

        // Limpiar tokens antiguos (más de 7 días)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        user.refreshTokens = user.refreshTokens.filter(
            tokenObj => tokenObj.createdAt > sevenDaysAgo
        );

        // Actualizar último login
        user.lastLogin = new Date();
        await user.save();

        res.json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    lastLogin: user.lastLogin,
                    name: user.name,
                    surname: user.surname,
                    birthday: user.birthday
                },
                tokens: {
                    accessToken,
                    refreshToken,
                    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
                }
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

// POST /auth/agent/login - Autenticación de agentes por email y contraseña
router.post('/agent/login', loginLimiter, async (req, res) => {
    try {
        const { email, password, agentId } = req.body;

        if (!email || !password || !agentId) {
            return res.status(400).json({
                success: false,
                error: 'Email, contraseña y agentId son requeridos'
            });
        }

        // Buscar usuario por email (activo) incluyendo password
        const user = await User.findOne({ email: email.toLowerCase(), isActive: true }).select('+password');
        if (!user) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        const valid = await user.matchPassword(password);
        if (!valid) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        // Buscar o crear el agente por agentId
        const Agent = require('../models/Agent');
        let agent = await Agent.findOne({ agentId });
        if (!agent) {
            // Si el agente no existe, crearlo mínimamente y vincularlo
            const crypto = require('crypto');
            agent = new Agent({
                agentId,
                name: agentId,
                description: 'Agente registrado por autenticación',
                apiKey: crypto.randomBytes(32).toString('hex'),
                user: user._id,
                status: 'offline'
            });
            await agent.save();
        } else if (!agent.user) {
            // Vincular agente sin propietario
            agent.user = user._id;
            await agent.save();
        } else if (String(agent.user) !== String(user._id)) {
            // El agentId ya pertenece a otro usuario
            return res.status(403).json({
                success: false,
                error: 'Este agente ya está asociado a otro usuario'
            });
        }

        // Generar tokens para el usuario
        const { accessToken, refreshToken } = generateTokens(user);

        // Guardar refresh token
        user.refreshTokens.push({ token: refreshToken, createdAt: new Date() });
        // Limpiar antiguos
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        user.refreshTokens = user.refreshTokens.filter(t => t.createdAt > sevenDaysAgo);
        user.lastLogin = new Date();
        await user.save();

        return res.json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    username: user.username,
                    email: user.email,
                    role: user.role
                },
                agent: {
                    id: agent._id,
                    agentId: agent.agentId,
                    name: agent.name,
                    user: agent.user
                },
                tokens: {
                    accessToken,
                    refreshToken,
                    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
                }
            }
        });
    } catch (error) {
        console.error('Error en login de agente:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// POST /auth/register
router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { username, email, password, name, surname, birthday } = req.body;

        // Validar datos de entrada
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario, email y contraseña son requeridos'
            });
        }

        // Validar longitud de contraseña
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        // Verificar si el usuario ya existe
        const existingUser = await User.findOne({
            $or: [{ username }, { email }]
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Usuario o email ya existe'
            });
        }

        // Crear nuevo usuario
        const newUser = new User({
            username,
            email,
            password,
            role: "user",
            name,
            surname,
            birthday
        });

        await newUser.save();

        res.status(201).json({
            success: true,
            message: 'Usuario registrado exitosamente',
            data: {
                user: {
                    id: newUser._id,
                    username: newUser.username,
                    email: newUser.email,
                    role: newUser.role,
                    name: newUser.name,
                    surname: newUser.surname,
                    birthday: newUser.birthday
                }
            }
        });

    } catch (error) {
        console.error('Error en registro:', error);

        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
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

// GET /auth/me - Obtener información del usuario actual
router.get('/me', authenticateToken, (req, res) => {
    res.json({
        success: true,
        data: {
            user: {
                id: req.user._id,
                username: req.user.username,
                email: req.user.email,
                role: req.user.role,
                lastLogin: req.user.lastLogin,
                name: req.user.name,
                surname: req.user.surname,
                birthday: req.user.birthday,
            }
        }
    });
});

// POST /auth/refresh - Renovar token
router.post('/refresh', verifyRefreshToken, async (req, res) => {
    try {
        const user = req.user;
        const oldRefreshToken = req.refreshToken;

        // Generar nuevos tokens
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

        // Remover el token antiguo y agregar el nuevo
        user.refreshTokens = user.refreshTokens.filter(
            tokenObj => tokenObj.token !== oldRefreshToken
        );

        user.refreshTokens.push({
            token: newRefreshToken,
            createdAt: new Date()
        });

        await user.save();

        res.json({
            success: true,
            data: {
                accessToken,
                refreshToken: newRefreshToken,
                expiresIn: process.env.JWT_EXPIRES_IN || '15m'
            }
        });

    } catch (error) {
        console.error('Error en refresh:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// POST /auth/logout - Cerrar sesión
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const { refreshToken } = req.body;
        const user = req.user;

        if (refreshToken) {
            // Remover el refresh token específico
            user.refreshTokens = user.refreshTokens.filter(
                tokenObj => tokenObj.token !== refreshToken
            );
        } else {
            // Remover todos los refresh tokens (logout de todos los dispositivos)
            user.refreshTokens = [];
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

// GET /auth/users - Listar usuarios (solo admin)
router.get('/users', authenticateToken, async (req, res) => {
    try {
        // Verificar que sea admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Solo administradores pueden ver usuarios'
            });
        }

        const { page = 1, limit = 10, search = '' } = req.query;

        const query = search ? {
            $or: [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const users = await User.find(query)
            .select('-refreshTokens')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    current: page * 1,
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

// POST /auth/qr/generate - Generar código QR para login
router.post('/qr/generate', async (req, res) => {
    try {
        const code = uuidv4();
        const deviceInfo = {
            userAgent: req.get('User-Agent'),
            ip: req.ip || req.connection.remoteAddress
        };

        // Crear registro en la base de datos
        const qrCode = new QRCodeModel({
            code,
            deviceInfo
        });

        await qrCode.save();

        res.json({
            success: true,
            data: {
                code,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutos
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

// GET /auth/qr/status/:code - Verificar estado del código QR
router.get('/qr/status/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const qrCode = await QRCodeModel.findOne({ code }).populate('userId', '-password -refreshTokens');

        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'Código QR no encontrado o expirado'
            });
        }

        // Si está autenticado, generar tokens para el dispositivo principal
        let tokens = {};
        if (qrCode.status === 'authenticated' && qrCode.userId) {
            // Buscar usuario (incluir password para verificación)
            const user = await User.findOne({
                _id: qrCode.userId._id,
                isActive: true
            }).select('+password');

            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: 'Credenciales inválidas'
                });
            }

            // Generar tokens
            const { accessToken, refreshToken } = generateTokens(user);

            tokens.accessToken = accessToken;
            tokens.refreshToken = refreshToken;
            tokens.expiresIn = process.env.JWT_EXPIRES_IN || '15m';

            // Guardar refresh token en el usuario
            user.refreshTokens.push({
                token: refreshToken,
                createdAt: new Date()
            });

            // Limpiar tokens antiguos
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            user.refreshTokens = user.refreshTokens.filter(
                tokenObj => tokenObj.createdAt > sevenDaysAgo
            );

            await user.save();
        }

        res.json({
            success: true,
            data: {
                status: qrCode.status,
                scannedAt: qrCode.scannedAt,
                authenticatedAt: qrCode.authenticatedAt,
                user: qrCode.userId ? {
                    id: qrCode.userId._id,
                    username: qrCode.userId.username,
                    email: qrCode.userId.email,
                    role: qrCode.userId.role,
                    name: qrCode.userId.name,
                    surname: qrCode.userId.surname,
                    birthday: qrCode.userId.birthday,
                    lastLogin: qrCode.userId.lastLogin
                } : null,
                tokens: tokens
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

// POST /auth/qr/scan - Marcar código QR como escaneado
router.post('/qr/scan', async (req, res) => {
    try {
        const { code } = req.body;

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

        // Marcar como escaneado
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

// POST /auth/qr/authenticate - Autenticar usando código QR
router.post('/qr/authenticate', async (req, res) => {
    try {
        const { code, username, password } = req.body;

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

        // Buscar y verificar usuario
        const user = await User.findOne({
            $or: [{ username }, { email: username }],
            isActive: true
        }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // Verificar contraseña
        const isValidPassword = await user.matchPassword(password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        // Generar tokens
        const { accessToken, refreshToken } = generateTokens(user);

        // Guardar refresh token
        user.refreshTokens.push({
            token: refreshToken,
            createdAt: new Date()
        });

        // Limpiar tokens antiguos
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        user.refreshTokens = user.refreshTokens.filter(
            tokenObj => tokenObj.createdAt > sevenDaysAgo
        );

        user.lastLogin = new Date();
        await user.save();

        // Marcar QR como autenticado
        qrCode.status = 'authenticated';
        qrCode.userId = user._id;
        qrCode.authenticatedAt = new Date();
        await qrCode.save();

        res.json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    lastLogin: user.lastLogin,
                    name: user.name,
                    surname: user.surname,
                    birthday: user.birthday
                },
                tokens: {
                    accessToken,
                    refreshToken
                }
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