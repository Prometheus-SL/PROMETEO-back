const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { randomBytes, randomUUID } = crypto;
const User = require('../models/User');
const Agent = require('../models/Agent');
const QRCodeModel = require('../models/QRCode');
const EmailToken = require('../models/EmailToken');
const { hashApiKey } = require('../services/agentApiKey');
const {
    authenticateToken,
    authorizeRole,
    generateTokens,
    verifyRefreshToken,
} = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { created, ok } = require('../http/responses');
const {
    isEmailServiceAvailable,
    generateSecureToken,
    hashToken,
    sendVerificationEmail,
    sendPasswordResetEmail,
} = require('../services/emailService');
const LoginHistory = require('../models/LoginHistory');
const { generateSecret, verifyTOTP, buildOtpauthUri, generateRecoveryCodes } = require('../services/totp');

const router = express.Router();
const LOGIN_HISTORY_RETENTION_DAYS = 30;
const LOGIN_HISTORY_RETENTION_MS = LOGIN_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 10000000 : 5,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many login attempts. Try again in 15 minutes.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many registration attempts. Try again in 1 hour.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const COMMON_PASSWORDS = new Set([
    'password1234', 'password12345', 'password123456',
    '123456789012', '1234567890123', '12345678901234',
    'qwerty123456', 'qwertyuiopas', 'qwertyuiop12',
    'letmein12345', 'welcome12345', 'admin1234567',
    'iloveyou1234', 'monkey123456', 'dragon123456',
    'master123456', 'trustno12345', 'baseball1234',
    'shadow123456', 'michael12345', 'football1234',
    'changeme1234', 'password!234', 'abcdef123456',
    'abcdefghijkl', 'aaaaaaaaaaaa', '111111111111',
    '000000000000', 'passwordpass', 'passpasspass',
]);

function isCommonPassword(password) {
    return COMMON_PASSWORDS.has(password.toLowerCase());
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizeSecondFactorToken(value) {
    return normalizeText(value).replace(/\s+/g, '').toUpperCase();
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
        birthday: user.birthday,
        avatarUrl: user.avatarUrl || null,
        avatarUpdatedAt: user.avatarUpdatedAt || null,
    };
}

function serializeTokens(tokens) {
    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId: tokens.sessionId,
        expiresIn: tokens.expiresIn ?? null,
    };
}

// ── Cookie HttpOnly del refresh token (login web) ──────────────────────────────
// El navegador guarda el refresh token en una cookie HttpOnly (no accesible por JS, así
// un XSS no puede robarlo de localStorage). El kiosko (QR) y HERMES siguen usando el
// token en el body. Requiere CORS con credenciales; en cross-site, SameSite=None.
const REFRESH_COOKIE_NAME = process.env.AUTH_REFRESH_COOKIE_NAME || 'prometeo_rt';
const REFRESH_COOKIE_ENABLED = process.env.AUTH_REFRESH_COOKIE !== 'false';
const REFRESH_COOKIE_SAMESITE = (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase();
const REFRESH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE
    ? process.env.AUTH_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
const REFRESH_COOKIE_PATH = '/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function refreshCookieOptions() {
    const options = {
        httpOnly: true,
        secure: REFRESH_COOKIE_SECURE,
        sameSite: REFRESH_COOKIE_SAMESITE,
        path: REFRESH_COOKIE_PATH,
    };
    if (process.env.AUTH_COOKIE_DOMAIN) {
        options.domain = process.env.AUTH_COOKIE_DOMAIN;
    }
    return options;
}

function setRefreshCookie(res, refreshToken) {
    if (!REFRESH_COOKIE_ENABLED || !refreshToken) {
        return;
    }
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
        ...refreshCookieOptions(),
        maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
}

function clearRefreshCookie(res) {
    if (!REFRESH_COOKIE_ENABLED) {
        return;
    }
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

function readRefreshCookie(req) {
    const header = req.headers?.cookie;
    if (!header) {
        return null;
    }
    const prefix = `${REFRESH_COOKIE_NAME}=`;
    const cookie = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    if (!cookie) {
        return null;
    }
    try {
        return decodeURIComponent(cookie.slice(prefix.length));
    } catch (_error) {
        return cookie.slice(prefix.length);
    }
}

// Inyecta el refresh token de la cookie en el body cuando el body no lo trae (web).
function injectRefreshCookie(req, _res, next) {
    if (!req.body || !req.body.refreshToken) {
        const cookieToken = readRefreshCookie(req);
        if (cookieToken) {
            req.body = req.body || {};
            req.body.refreshToken = cookieToken;
        }
    }
    next();
}

function getLoginHistoryCutoffDate() {
    return new Date(Date.now() - LOGIN_HISTORY_RETENTION_MS);
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

function recordLogin(userId, username, req, overrides = {}) {
    const meta = getRequestMetadata(req);
    LoginHistory.create({
        userId: userId || null,
        username: username || null,
        method: overrides.method || 'password',
        provider: overrides.provider || null,
        identifier: normalizeText(overrides.identifier) || null,
        success: overrides.success !== undefined ? overrides.success : true,
        ip: meta.ip,
        userAgent: meta.userAgent,
        sessionId: overrides.sessionId || null,
        failureReason: overrides.failureReason || null,
    }).catch(() => { });
}

function isTwoFactorEnabled(user) {
    return Boolean(user.twoFactor?.enabled);
}

function consumeRecoveryCode(user, token) {
    const normalizedToken = normalizeSecondFactorToken(token).replace(/[^A-Z0-9]/g, '');
    if (!normalizedToken) {
        return false;
    }

    const hash = crypto.createHash('sha256').update(normalizedToken).digest('hex');
    const recoveryCodes = Array.isArray(user.twoFactor?.recoveryCodes)
        ? user.twoFactor.recoveryCodes
        : [];
    const index = recoveryCodes.findIndex((storedHash) => {
        try {
            return crypto.timingSafeEqual(
                Buffer.from(storedHash, 'utf8'),
                Buffer.from(hash, 'utf8')
            );
        } catch (_error) {
            return storedHash === hash;
        }
    });

    if (index === -1) {
        return false;
    }

    user.twoFactor.recoveryCodes.splice(index, 1);
    return true;
}

function verifySecondFactor(user, token) {
    const normalizedToken = normalizeSecondFactorToken(token);
    if (!normalizedToken || !user.twoFactor?.secret) {
        return false;
    }

    if (/^\d{6}$/.test(normalizedToken) && verifyTOTP(user.twoFactor.secret, normalizedToken)) {
        return true;
    }

    return consumeRecoveryCode(user, normalizedToken);
}

async function issueSessionTokens(user, req, options = {}) {
    const tokens = generateTokens(user, { sessionId: options.sessionId });
    registerIssuedSession(user, tokens, req, options);
    await user.save();
    return tokens;
}

async function findUserForLogin(identifier) {
    const normalizedIdentifier = normalizeText(identifier);
    if (!normalizedIdentifier) {
        return null;
    }

    return User.findOne({
        $or: [
            { username: normalizedIdentifier },
            { email: normalizeEmail(normalizedIdentifier) },
        ],
        isActive: true,
    }).select('+password +twoFactor.secret +twoFactor.recoveryCodes');
}

async function verifyUserCredentials(identifier, password) {
    const user = await findUserForLogin(identifier);
    if (!user) {
        return {
            user: null,
            passwordValid: false,
        };
    }

    return {
        user,
        passwordValid: await user.matchPassword(password),
    };
}

async function findOrCreateAgentForUser(user, agentId) {
    let agent = await Agent.findOne({ agentId });

    if (!agent) {
        agent = new Agent({
            agentId,
            name: agentId,
            description: 'Agent registered by authentication',
            apiKey: hashApiKey(randomBytes(32).toString('hex')),
            user: user._id,
            status: 'offline',
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

    // Login por QR = dispositivo de tipo kiosko (p. ej. Raspberry): sesión de larga
    // duración para que la pantalla no se desloguee sola. Sigue siendo revocable.
    const tokens = generateTokens(user, { kiosk: true });
    registerIssuedSession(user, tokens, req);

    qrCode.issuedSessionId = tokens.sessionId;
    qrCode.issuedTokens = serializeTokens(tokens);

    await Promise.all([user.save(), qrCode.save()]);
    return qrCode.issuedTokens;
}

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const username = normalizeText(req.body?.username);
    const password = req.body?.password;
    const secondFactorToken = req.body?.totpToken || req.body?.twoFactorToken || req.body?.token;

    if (!username || !password) {
        throw createHttpError(400, 'LOGIN_FIELDS_REQUIRED', 'Username or email and password are required');
    }

    const credentials = await verifyUserCredentials(username, password);
    if (!credentials.user) {
        recordLogin(null, null, req, {
            method: 'password',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
            identifier: username,
        });
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const user = credentials.user;
    if (!credentials.passwordValid) {
        recordLogin(user._id, user.username, req, {
            method: 'password',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
            identifier: username,
        });
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    if (isTwoFactorEnabled(user)) {
        if (!secondFactorToken) {
            return ok(res, {
                twoFactorRequired: true,
                user: serializeUser(user),
            }, {
                message: 'Two-factor authentication required',
            });
        }

        if (!verifySecondFactor(user, secondFactorToken)) {
            recordLogin(user._id, user.username, req, {
                method: 'password',
                success: false,
                failureReason: 'INVALID_TOTP_TOKEN',
                identifier: username,
            });
            throw createHttpError(401, 'INVALID_TOTP_TOKEN', 'Invalid authentication code');
        }
    }

    const tokens = await issueSessionTokens(user, req);
    recordLogin(user._id, user.username, req, {
        method: 'password',
        sessionId: tokens.sessionId,
        identifier: username,
    });
    setRefreshCookie(res, tokens.refreshToken);
    return ok(res, {
        user: serializeUser(user),
        tokens: serializeTokens(tokens),
    });
}));

router.post('/agent/login', loginLimiter, asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const agentId = normalizeText(req.body?.agentId);

    if (!email || !password || !agentId) {
        throw createHttpError(400, 'AGENT_LOGIN_FIELDS_REQUIRED', 'email, password, and agentId are required');
    }

    const user = await User.findOne({ email, isActive: true }).select('+password');
    if (!user) {
        recordLogin(null, null, req, {
            method: 'agent',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
            identifier: email,
        });
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    if (!(await user.matchPassword(password))) {
        recordLogin(user._id, user.username, req, {
            method: 'agent',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
            identifier: email,
        });
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const agent = await findOrCreateAgentForUser(user, agentId);
    if (!agent) {
        throw createHttpError(403, 'AGENT_ALREADY_ASSIGNED', 'This agent is already assigned to another user');
    }

    const tokens = await issueSessionTokens(user, req);
    recordLogin(user._id, user.username, req, {
        method: 'agent',
        sessionId: tokens.sessionId,
        identifier: email,
    });
    return ok(res, {
        user: serializeUser(user),
        agent: {
            id: agent._id,
            agentId: agent.agentId,
            name: agent.name,
            user: agent.user,
        },
        tokens: serializeTokens(tokens),
    });
}));

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
    const username = normalizeText(req.body?.username);
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const name = normalizeText(req.body?.name);
    const surname = normalizeText(req.body?.surname);
    const birthday = req.body?.birthday;

    if (!username || !email || !password) {
        throw createHttpError(400, 'REGISTER_FIELDS_REQUIRED', 'username, email, and password are required');
    }

    if (password.length < 12) {
        throw createHttpError(400, 'PASSWORD_TOO_SHORT', 'Password must be at least 12 characters long');
    }

    if (isCommonPassword(password)) {
        throw createHttpError(400, 'PASSWORD_TOO_COMMON', 'This password is too common. Choose a stronger one.');
    }

    const existingUser = await User.findOne({
        $or: [{ username }, { email }],
    });

    if (existingUser) {
        throw createHttpError(409, 'USER_ALREADY_EXISTS', 'Username or email already exists');
    }

    const newUser = new User({
        username,
        email,
        password,
        role: 'user',
        name: name || undefined,
        surname: surname || undefined,
        birthday: birthday || undefined,
    });
    await newUser.save();

    if (isEmailServiceAvailable()) {
        const rawToken = generateSecureToken();
        await EmailToken.create({
            userId: newUser._id,
            tokenHash: hashToken(rawToken),
            type: 'email-verification',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        await sendVerificationEmail(email, rawToken).catch((err) =>
            console.error('[Auth] Failed to send verification email:', err.message)
        );
    }

    return created(res, {
        user: serializeUser(newUser),
    }, {
        message: 'User registered successfully',
    });
}));

router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
    return ok(res, {
        user: serializeUser(req.user),
        session: {
            sessionId: req.auth?.sessionId || null,
        },
    });
}));

router.get('/login-history', authenticateToken, asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const query = {
        userId: req.user._id,
        createdAt: { $gte: getLoginHistoryCutoffDate() },
    };

    const entries = await LoginHistory.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean();

    const total = await LoginHistory.countDocuments(query);

    return ok(res, {
        history: entries,
        entries,
        pagination: { current: page, pages: Math.ceil(total / limit), total },
        retentionDays: LOGIN_HISTORY_RETENTION_DAYS,
    });
}));

router.get('/sessions', authenticateToken, asyncHandler(async (req, res) => {
    const sessions = (req.user.refreshTokens || []).map((session) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        userAgent: session.userAgent || null,
        ip: session.ip || null,
        current: session.sessionId === req.auth?.sessionId,
    }));

    return ok(res, { sessions });
}));

router.delete('/sessions/:sessionId', authenticateToken, asyncHandler(async (req, res) => {
    const targetSessionId = req.params.sessionId;
    const user = req.user;

    if (!user.hasSession(targetSessionId)) {
        throw createHttpError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    user.removeSessionBySessionId(targetSessionId);
    await user.save();

    return ok(res, null, { message: 'Session revoked' });
}));

router.post('/refresh', injectRefreshCookie, verifyRefreshToken, asyncHandler(async (req, res) => {
    const user = req.user;
    const sessionId = req.auth?.sessionId || randomUUID();

    user.removeSessionByRefreshToken(req.refreshToken);

    const tokens = generateTokens(user, { sessionId });
    registerIssuedSession(user, tokens, req, { updateLastLogin: false });
    await user.save();

    setRefreshCookie(res, tokens.refreshToken);
    return ok(res, serializeTokens(tokens));
}));

router.post('/logout', authenticateToken, asyncHandler(async (req, res) => {
    const refreshToken = normalizeText(req.body?.refreshToken) || readRefreshCookie(req);
    const user = req.user;

    if (refreshToken) {
        user.removeSessionByRefreshToken(refreshToken);
    } else {
        user.revokeAllSessions();
    }

    await user.save();
    clearRefreshCookie(res);
    return ok(res, null, { message: 'Session closed successfully' });
}));

router.get('/users', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = normalizeText(req.query.search);

    const query = search ? {
        $or: [
            { username: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ],
    } : {};

    const users = await User.find(query)
        .select('-refreshTokens -tokenInvalidBefore')
        .limit(limit)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    return ok(res, {
        users,
        pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total,
        },
    });
}));

router.post('/qr/generate', asyncHandler(async (req, res) => {
    const code = randomUUID();
    const qrCode = new QRCodeModel({
        code,
        deviceInfo: getRequestMetadata(req),
    });

    await qrCode.save();

    return ok(res, {
        code,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
}));

router.get('/qr/status/:code', asyncHandler(async (req, res) => {
    const code = normalizeText(req.params.code);
    const qrCode = await QRCodeModel.findOne({ code }).populate('userId', '-password -refreshTokens -tokenInvalidBefore');

    if (!qrCode) {
        throw createHttpError(404, 'QR_CODE_NOT_FOUND', 'QR code was not found or has expired');
    }

    let tokens = qrCode.issuedTokens || {};

    if (qrCode.status === 'authenticated' && qrCode.userId && (!tokens.accessToken || !tokens.refreshToken)) {
        const user = await User.findOne({ _id: qrCode.userId._id, isActive: true });
        if (!user) {
            throw createHttpError(401, 'USER_INACTIVE', 'User not found or inactive');
        }

        tokens = await ensureQrIssuedTokens(qrCode, user, req);
    }

    return ok(res, {
        status: qrCode.status,
        scannedAt: qrCode.scannedAt,
        authenticatedAt: qrCode.authenticatedAt,
        user: qrCode.userId ? serializeUser(qrCode.userId) : null,
        tokens,
    });
}));

router.post('/qr/scan', asyncHandler(async (req, res) => {
    const code = normalizeText(req.body?.code);
    if (!code) {
        throw createHttpError(400, 'QR_CODE_REQUIRED', 'QR code is required');
    }

    const qrCode = await QRCodeModel.findOneAndUpdate(
        { code, status: 'pending' },
        { $set: { status: 'scanned', scannedAt: new Date() } },
        { new: true }
    );

    if (!qrCode) {
        const existing = await QRCodeModel.findOne({ code });
        if (!existing) {
            throw createHttpError(404, 'QR_CODE_NOT_FOUND', 'QR code was not found or has expired');
        }
        throw createHttpError(400, 'QR_CODE_NOT_PENDING', 'QR code has already been used');
    }

    return ok(res, null, { message: 'QR code scanned successfully' });
}));

router.post('/qr/authenticate', asyncHandler(async (req, res) => {
    const code = normalizeText(req.body?.code);
    const username = normalizeText(req.body?.username);
    const password = req.body?.password;

    if (!code || !username || !password) {
        throw createHttpError(400, 'QR_AUTH_FIELDS_REQUIRED', 'QR code, username or email, and password are required');
    }

    const credentials = await verifyUserCredentials(username, password);
    if (!credentials.user) {
        recordLogin(null, null, req, {
            method: 'qr',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
            identifier: username,
        });
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const user = credentials.user;
    if (!credentials.passwordValid) {
        recordLogin(user._id, user.username, req, {
            method: 'qr',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
            identifier: username,
        });
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const qrCode = await QRCodeModel.findOneAndUpdate(
        { code, status: 'scanned' },
        {
            $set: {
                status: 'authenticated',
                userId: user._id,
                authenticatedAt: new Date(),
            },
        },
        { new: true }
    );

    if (!qrCode) {
        const existing = await QRCodeModel.findOne({ code });
        if (!existing) {
            throw createHttpError(404, 'QR_CODE_NOT_FOUND', 'QR code was not found or has expired');
        }
        throw createHttpError(400, 'QR_CODE_NOT_SCANNED', 'QR code has not been scanned or has already been used');
    }

    const tokens = await ensureQrIssuedTokens(qrCode, user, req);
    recordLogin(user._id, user.username, req, {
        method: 'qr',
        sessionId: tokens.sessionId || null,
        identifier: username,
    });

    return ok(res, {
        user: serializeUser(user),
        tokens,
    });
}));

/* ─── Email verification ─── */

router.post('/verify-email', asyncHandler(async (req, res) => {
    const token = normalizeText(req.body?.token);
    if (!token) {
        throw createHttpError(400, 'TOKEN_REQUIRED', 'Verification token is required');
    }

    const tokenDoc = await EmailToken.findOne({
        tokenHash: hashToken(token),
        type: 'email-verification',
        expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
        throw createHttpError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Verification token is invalid or expired');
    }

    const user = await User.findById(tokenDoc.userId);
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    user.emailVerified = true;
    await user.save();
    await EmailToken.deleteMany({ userId: user._id, type: 'email-verification' });

    return ok(res, null, { message: 'Email verified successfully' });
}));

router.post('/resend-verification', authenticateToken, asyncHandler(async (req, res) => {
    if (!isEmailServiceAvailable()) {
        throw createHttpError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }

    const user = req.user;
    if (user.emailVerified) {
        return ok(res, null, { message: 'Email is already verified' });
    }

    await EmailToken.deleteMany({ userId: user._id, type: 'email-verification' });

    const rawToken = generateSecureToken();
    await EmailToken.create({
        userId: user._id,
        tokenHash: hashToken(rawToken),
        type: 'email-verification',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await sendVerificationEmail(user.email, rawToken);
    return ok(res, null, { message: 'Verification email sent' });
}));

/* ─── Password reset ─── */

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many password reset attempts. Try again later.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/forgot-password', forgotPasswordLimiter, asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
        throw createHttpError(400, 'EMAIL_REQUIRED', 'Email is required');
    }

    // Always return success to prevent email enumeration
    const user = await User.findOne({ email, isActive: true });
    if (!user || !isEmailServiceAvailable()) {
        return ok(res, null, { message: 'If that email exists, a reset link has been sent.' });
    }

    await EmailToken.deleteMany({ userId: user._id, type: 'password-reset' });

    const rawToken = generateSecureToken();
    await EmailToken.create({
        userId: user._id,
        tokenHash: hashToken(rawToken),
        type: 'password-reset',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    await sendPasswordResetEmail(email, rawToken).catch((err) =>
        console.error('[Auth] Failed to send password reset email:', err.message)
    );

    return ok(res, null, { message: 'If that email exists, a reset link has been sent.' });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
    const token = normalizeText(req.body?.token);
    const newPassword = req.body?.password;

    if (!token || !newPassword) {
        throw createHttpError(400, 'FIELDS_REQUIRED', 'Token and new password are required');
    }

    if (newPassword.length < 12) {
        throw createHttpError(400, 'PASSWORD_TOO_SHORT', 'Password must be at least 12 characters long');
    }

    if (isCommonPassword(newPassword)) {
        throw createHttpError(400, 'PASSWORD_TOO_COMMON', 'This password is too common. Choose a stronger one.');
    }

    const tokenDoc = await EmailToken.findOne({
        tokenHash: hashToken(token),
        type: 'password-reset',
        expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
        throw createHttpError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Reset token is invalid or expired');
    }

    const user = await User.findById(tokenDoc.userId).select('+password');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    user.password = newPassword;
    user.revokeAllSessions();
    await user.save();
    await EmailToken.deleteMany({ userId: user._id, type: 'password-reset' });

    return ok(res, null, { message: 'Password reset successfully. Please log in again.' });
}));

/* ─── 2FA / TOTP ─── */

router.post('/2fa/setup', authenticateToken, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+twoFactor.secret +twoFactor.recoveryCodes');
    if (user.twoFactor?.enabled) {
        throw createHttpError(400, '2FA_ALREADY_ENABLED', '2FA is already enabled');
    }

    const secret = generateSecret();
    const uri = buildOtpauthUri(secret, user.username);

    user.twoFactor = user.twoFactor || {};
    user.twoFactor.secret = secret;
    await user.save();

    return ok(res, {
        secret,
        uri,
        otpauthUri: uri,
    }, { message: 'Scan the QR code with your authenticator app, then confirm with /2fa/confirm' });
}));

router.post('/2fa/confirm', authenticateToken, asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string' || token.length !== 6) {
        throw createHttpError(400, 'INVALID_TOTP_TOKEN', 'A 6-digit token is required');
    }

    const user = await User.findById(req.user._id).select('+twoFactor.secret +twoFactor.recoveryCodes');
    if (!user.twoFactor?.secret) {
        throw createHttpError(400, '2FA_NOT_SETUP', 'Call /2fa/setup first');
    }
    if (user.twoFactor.enabled) {
        throw createHttpError(400, '2FA_ALREADY_ENABLED', '2FA is already enabled');
    }

    if (!verifyTOTP(user.twoFactor.secret, token)) {
        throw createHttpError(401, 'INVALID_TOTP_TOKEN', 'Invalid TOTP token');
    }

    const codes = generateRecoveryCodes();
    user.twoFactor.enabled = true;
    user.twoFactor.enabledAt = new Date();
    user.twoFactor.recoveryCodes = codes.map((c) => crypto.createHash('sha256').update(c).digest('hex'));
    await user.save();

    return ok(res, { recoveryCodes: codes }, { message: '2FA enabled. Save your recovery codes.' });
}));

router.post('/2fa/disable', authenticateToken, asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    const user = await User.findById(req.user._id).select('+twoFactor.secret +twoFactor.recoveryCodes');

    if (!user.twoFactor?.enabled) {
        throw createHttpError(400, '2FA_NOT_ENABLED', '2FA is not enabled');
    }

    if (!token || !verifyTOTP(user.twoFactor.secret, token)) {
        throw createHttpError(401, 'INVALID_TOTP_TOKEN', 'A valid TOTP token is required to disable 2FA');
    }

    user.twoFactor = { enabled: false, secret: null, recoveryCodes: [], enabledAt: null };
    await user.save();

    return ok(res, null, { message: '2FA disabled' });
}));

router.post('/2fa/recovery-codes/regenerate', authenticateToken, asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    const user = await User.findById(req.user._id).select('+twoFactor.secret +twoFactor.recoveryCodes');

    if (!user.twoFactor?.enabled) {
        throw createHttpError(400, '2FA_NOT_ENABLED', '2FA is not enabled');
    }

    if (!token || !verifyTOTP(user.twoFactor.secret, token)) {
        throw createHttpError(401, 'INVALID_TOTP_TOKEN', 'A valid TOTP token is required to regenerate recovery codes');
    }

    const codes = generateRecoveryCodes();
    user.twoFactor.recoveryCodes = codes.map((code) => crypto.createHash('sha256').update(code).digest('hex'));
    await user.save();

    return ok(res, { recoveryCodes: codes }, { message: 'Recovery codes regenerated. Save the new set in a safe place.' });
}));

router.get('/2fa/status', authenticateToken, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+twoFactor.recoveryCodes');

    return ok(res, {
        enabled: user.twoFactor?.enabled || false,
        enabledAt: user.twoFactor?.enabledAt || null,
        recoveryCodesRemaining: Array.isArray(user.twoFactor?.recoveryCodes)
            ? user.twoFactor.recoveryCodes.length
            : 0,
    });
}));

module.exports = router;
