const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Agent = require('../models/Agent');
const { createHttpError } = require('../http/errors');

function createAuthError(status, code, message) {
    return createHttpError(status, code, message);
}

function extractBearerToken(req) {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || typeof authHeader !== 'string') {
        return null;
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return null;
    }

    return token;
}

function decodeJwt(token, secret, invalidMessage, invalidCode) {
    try {
        return jwt.verify(token, secret, { ignoreExpiration: true });
    } catch (_error) {
        throw createAuthError(403, invalidCode, invalidMessage);
    }
}

function wasTokenInvalidated(decoded, user) {
    if (!user?.tokenInvalidBefore || !decoded?.iat) {
        return false;
    }

    return (decoded.iat * 1000) < user.tokenInvalidBefore.getTime();
}

async function loadActiveUser(userId) {
    const user = await User.findById(userId);
    if (!user || !user.isActive) {
        throw createAuthError(401, 'USER_INACTIVE', 'User not found or inactive');
    }

    return user;
}

async function verifyAccessToken(token) {
    if (!token) {
        throw createAuthError(401, 'ACCESS_TOKEN_REQUIRED', 'Access token is required');
    }

    const decoded = decodeJwt(token, process.env.JWT_SECRET, 'Access token is invalid', 'INVALID_ACCESS_TOKEN');
    if (decoded?.type && decoded.type !== 'access') {
        throw createAuthError(403, 'INVALID_ACCESS_TOKEN', 'Access token is invalid');
    }

    const user = await loadActiveUser(decoded.id);

    if (wasTokenInvalidated(decoded, user)) {
        throw createAuthError(401, 'SESSION_REVOKED', 'The session has been closed. Sign in again.');
    }

    if (decoded.sessionId && !user.hasSession(decoded.sessionId)) {
        throw createAuthError(401, 'SESSION_NOT_ACTIVE', 'The session is no longer active.');
    }

    return {
        user,
        decoded,
        sessionId: decoded.sessionId || null,
        token,
    };
}

async function verifyRefreshTokenValue(refreshToken) {
    if (!refreshToken) {
        throw createAuthError(401, 'REFRESH_TOKEN_REQUIRED', 'Refresh token is required');
    }

    const decoded = decodeJwt(
        refreshToken,
        process.env.JWT_REFRESH_SECRET,
        'Refresh token is invalid',
        'INVALID_REFRESH_TOKEN'
    );
    if (decoded?.type && decoded.type !== 'refresh') {
        throw createAuthError(403, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
    }

    const user = await loadActiveUser(decoded.id);

    if (wasTokenInvalidated(decoded, user)) {
        throw createAuthError(401, 'SESSION_REVOKED', 'The session has been closed. Sign in again.');
    }

    const isKnownToken = decoded.sessionId
        ? user.hasRefreshToken(refreshToken, decoded.sessionId)
        : user.hasRefreshToken(refreshToken);

    if (!isKnownToken) {
        throw createAuthError(403, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
    }

    return {
        user,
        decoded,
        sessionId: decoded.sessionId || null,
        token: refreshToken,
    };
}

const authenticateToken = async (req, _res, next) => {
    try {
        const token = extractBearerToken(req);
        const auth = await verifyAccessToken(token);

        req.user = auth.user;
        req.auth = auth;
        next();
    } catch (error) {
        next(error);
    }
};

const requireAgentOwnership = async (req, _res, next) => {
    try {
        if (!req.user) {
            return next(createHttpError(401, 'UNAUTHENTICATED', 'User is not authenticated'));
        }

        const agentId = req.headers['x-agent-id'] || req.body.agentId || req.params.agentId;
        if (!agentId) {
            return next(createHttpError(400, 'AGENT_ID_REQUIRED', 'agentId is required'));
        }

        const agent = await Agent.findOne({ agentId, user: req.user._id });
        if (!agent) {
            return next(createHttpError(403, 'AGENT_ACCESS_DENIED', 'The authenticated user does not own this agent'));
        }

        req.agent = agent;
        if (req.body && req.body.agentId && req.body.agentId !== agent.agentId) {
            return next(createHttpError(403, 'AGENT_ID_MISMATCH', 'agentId does not match the owned agent'));
        }

        next();
    } catch (error) {
        console.error('Error checking agent ownership:', error);
        next(createHttpError(500, 'INTERNAL_SERVER_ERROR', 'Internal server error'));
    }
};

const authorizeRole = (...roles) => {
    return (req, _res, next) => {
        if (!req.user) {
            return next(createHttpError(401, 'UNAUTHENTICATED', 'User is not authenticated'));
        }

        if (!roles.includes(req.user.role)) {
            return next(createHttpError(403, 'FORBIDDEN', 'You do not have permission to access this resource'));
        }

        next();
    };
};

const authenticateAgent = async (req, _res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        const agentId = req.headers['x-agent-id'];

        if (!apiKey) {
            return next(createHttpError(401, 'API_KEY_REQUIRED', 'API key is required'));
        }

        const agent = await Agent.findOne({ apiKey, isActive: { $ne: false } });
        if (!agent) {
            return next(createHttpError(403, 'INVALID_API_KEY', 'API key is invalid or the agent is inactive'));
        }

        if (agentId && agent.agentId !== agentId) {
            return next(createHttpError(403, 'AGENT_ID_MISMATCH', 'Agent ID does not match the API key owner'));
        }

        agent.lastSeen = new Date();
        await agent.save();

        req.agent = agent;
        next();
    } catch (error) {
        console.error('Error in agent authentication:', error);
        next(createHttpError(500, 'INTERNAL_SERVER_ERROR', 'Internal server error'));
    }
};

const optionalAuth = async (req, _res, next) => {
    try {
        const token = extractBearerToken(req);
        if (!token) {
            return next();
        }

        const auth = await verifyAccessToken(token);
        req.user = auth.user;
        req.auth = auth;
        next();
    } catch (_error) {
        next();
    }
};

const generateTokens = (user, options = {}) => {
    const sessionId = options.sessionId || crypto.randomUUID();

    const accessToken = jwt.sign(
        {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            sessionId,
            type: 'access',
        },
        process.env.JWT_SECRET
    );

    const refreshToken = jwt.sign(
        {
            id: user._id,
            sessionId,
            type: 'refresh',
        },
        process.env.JWT_REFRESH_SECRET
    );

    return { accessToken, refreshToken, sessionId, expiresIn: null };
};

const verifyRefreshToken = async (req, _res, next) => {
    try {
        const refreshToken = req.body?.refreshToken;
        const auth = await verifyRefreshTokenValue(refreshToken);

        req.user = auth.user;
        req.refreshToken = refreshToken;
        req.auth = auth;
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = {
    authenticateToken,
    authorizeRole,
    authenticateAgent,
    requireAgentOwnership,
    optionalAuth,
    generateTokens,
    verifyAccessToken,
    verifyRefreshToken,
    verifyRefreshTokenValue,
};
