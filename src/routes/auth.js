const express = require('express');
const rateLimit = require('express-rate-limit');
const { randomBytes, randomUUID } = require('crypto');
const User = require('../models/User');
const Agent = require('../models/Agent');
const QRCodeModel = require('../models/QRCode');
const {
    authenticateToken,
    authorizeRole,
    generateTokens,
    verifyRefreshToken,
} = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { created, ok } = require('../http/responses');

const router = express.Router();

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
        birthday: user.birthday,
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
    if (!normalizedIdentifier) {
        return null;
    }

    return User.findOne({
        $or: [
            { username: normalizedIdentifier },
            { email: normalizeEmail(normalizedIdentifier) },
        ],
        isActive: true,
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
            description: 'Agent registered by authentication',
            apiKey: randomBytes(32).toString('hex'),
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

    const tokens = generateTokens(user);
    registerIssuedSession(user, tokens, req);

    qrCode.issuedSessionId = tokens.sessionId;
    qrCode.issuedTokens = serializeTokens(tokens);

    await Promise.all([user.save(), qrCode.save()]);
    return qrCode.issuedTokens;
}

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const username = normalizeText(req.body?.username);
    const password = req.body?.password;

    if (!username || !password) {
        throw createHttpError(400, 'LOGIN_FIELDS_REQUIRED', 'Username or email and password are required');
    }

    const user = await authenticateUserCredentials(username, password);
    if (!user) {
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const tokens = await issueSessionTokens(user, req);
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
    if (!user || !(await user.matchPassword(password))) {
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const agent = await findOrCreateAgentForUser(user, agentId);
    if (!agent) {
        throw createHttpError(403, 'AGENT_ALREADY_ASSIGNED', 'This agent is already assigned to another user');
    }

    const tokens = await issueSessionTokens(user, req);
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

    if (password.length < 6) {
        throw createHttpError(400, 'PASSWORD_TOO_SHORT', 'Password must be at least 6 characters long');
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

router.post('/refresh', verifyRefreshToken, asyncHandler(async (req, res) => {
    const user = req.user;
    const sessionId = req.auth?.sessionId || randomUUID();

    user.removeSessionByRefreshToken(req.refreshToken);

    const tokens = generateTokens(user, { sessionId });
    registerIssuedSession(user, tokens, req, { updateLastLogin: false });
    await user.save();

    return ok(res, serializeTokens(tokens));
}));

router.post('/logout', authenticateToken, asyncHandler(async (req, res) => {
    const refreshToken = normalizeText(req.body?.refreshToken);
    const user = req.user;

    if (refreshToken) {
        user.removeSessionByRefreshToken(refreshToken);
    } else {
        user.revokeAllSessions();
    }

    await user.save();
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

    const qrCode = await QRCodeModel.findOne({ code });
    if (!qrCode) {
        throw createHttpError(404, 'QR_CODE_NOT_FOUND', 'QR code was not found or has expired');
    }

    if (qrCode.status !== 'pending') {
        throw createHttpError(400, 'QR_CODE_NOT_PENDING', 'QR code has already been used');
    }

    qrCode.status = 'scanned';
    qrCode.scannedAt = new Date();
    await qrCode.save();

    return ok(res, null, { message: 'QR code scanned successfully' });
}));

router.post('/qr/authenticate', asyncHandler(async (req, res) => {
    const code = normalizeText(req.body?.code);
    const username = normalizeText(req.body?.username);
    const password = req.body?.password;

    if (!code || !username || !password) {
        throw createHttpError(400, 'QR_AUTH_FIELDS_REQUIRED', 'QR code, username or email, and password are required');
    }

    const qrCode = await QRCodeModel.findOne({ code });
    if (!qrCode) {
        throw createHttpError(404, 'QR_CODE_NOT_FOUND', 'QR code was not found or has expired');
    }

    if (qrCode.status !== 'scanned') {
        throw createHttpError(400, 'QR_CODE_NOT_SCANNED', 'QR code has not been scanned or has already been used');
    }

    const user = await authenticateUserCredentials(username, password);
    if (!user) {
        throw createHttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    qrCode.status = 'authenticated';
    qrCode.userId = user._id;
    qrCode.authenticatedAt = new Date();

    const tokens = await ensureQrIssuedTokens(qrCode, user, req);

    return ok(res, {
        user: serializeUser(user),
        tokens,
    });
}));

module.exports = router;
