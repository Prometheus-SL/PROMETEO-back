const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Agent = require('../models/Agent');

function createAuthError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
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

function decodeJwt(token, secret, invalidMessage) {
    try {
        return jwt.verify(token, secret, { ignoreExpiration: true });
    } catch (_error) {
        throw createAuthError(403, invalidMessage);
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
        throw createAuthError(401, 'Usuario no encontrado o inactivo');
    }

    return user;
}

async function verifyAccessToken(token) {
    if (!token) {
        throw createAuthError(401, 'Token de acceso requerido');
    }

    const decoded = decodeJwt(token, process.env.JWT_SECRET, 'Token inválido');
    if (decoded?.type && decoded.type !== 'access') {
        throw createAuthError(403, 'Token inválido');
    }

    const user = await loadActiveUser(decoded.id);

    if (wasTokenInvalidated(decoded, user)) {
        throw createAuthError(401, 'La sesión fue cerrada. Inicia sesión de nuevo');
    }

    if (decoded.sessionId && !user.hasSession(decoded.sessionId)) {
        throw createAuthError(401, 'La sesión ya no está activa');
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
        throw createAuthError(401, 'Refresh token requerido');
    }

    const decoded = decodeJwt(refreshToken, process.env.JWT_REFRESH_SECRET, 'Refresh token inválido');
    if (decoded?.type && decoded.type !== 'refresh') {
        throw createAuthError(403, 'Refresh token inválido');
    }

    const user = await loadActiveUser(decoded.id);

    if (wasTokenInvalidated(decoded, user)) {
        throw createAuthError(401, 'La sesión fue cerrada. Inicia sesión de nuevo');
    }

    const isKnownToken = decoded.sessionId
        ? user.hasRefreshToken(refreshToken, decoded.sessionId)
        : user.hasRefreshToken(refreshToken);

    if (!isKnownToken) {
        throw createAuthError(403, 'Refresh token inválido');
    }

    return {
        user,
        decoded,
        sessionId: decoded.sessionId || null,
        token: refreshToken,
    };
}

// Middleware para verificar JWT
const authenticateToken = async (req, res, next) => {
    try {
        const token = extractBearerToken(req);
        const auth = await verifyAccessToken(token);

        req.user = auth.user;
        req.auth = auth;
        next();
    } catch (error) {
        return res.status(error.status || 403).json({
            success: false,
            error: error.message || 'Token inválido'
        });
    }
};

// Middleware para verificar que un agentId pertenece al usuario autenticado
const requireAgentOwnership = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Usuario no autenticado' });
        }

        const agentId = req.headers['x-agent-id'] || req.body.agentId || req.params.agentId;
        if (!agentId) {
            return res.status(400).json({ success: false, error: 'agentId es requerido' });
        }

        const agent = await Agent.findOne({ agentId, user: req.user._id });
        if (!agent) {
            return res.status(403).json({ success: false, error: 'El agente no pertenece al usuario autenticado' });
        }

        req.agent = agent;
        if (req.body && req.body.agentId && req.body.agentId !== agent.agentId) {
            return res.status(403).json({ success: false, error: 'agentId no coincide con el agente del usuario' });
        }

        next();
    } catch (error) {
        console.error('Error verificando propiedad de agente:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
};

// Middleware para verificar roles específicos
const authorizeRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Usuario no autenticado'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos para acceder a este recurso'
            });
        }

        next();
    };
};

// Middleware para autenticación de agentes (API Key)
const authenticateAgent = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        const agentId = req.headers['x-agent-id'];

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API Key requerida'
            });
        }

        const agent = await Agent.findOne({ apiKey, isActive: { $ne: false } });
        if (!agent) {
            return res.status(403).json({
                success: false,
                error: 'API Key inválida o agente inactivo'
            });
        }

        if (agentId && agent.agentId !== agentId) {
            return res.status(403).json({
                success: false,
                error: 'Agent ID no coincide'
            });
        }

        agent.lastSeen = new Date();
        await agent.save();

        req.agent = agent;
        next();
    } catch (error) {
        console.error('Error en autenticación de agente:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// Middleware para autenticación opcional (no falla si no hay token)
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

// Utilidad para generar tokens JWT sin caducidad automática.
const generateTokens = (user, options = {}) => {
    const sessionId = options.sessionId || crypto.randomUUID();

    const accessToken = jwt.sign(
        {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            sessionId,
            type: 'access'
        },
        process.env.JWT_SECRET
    );

    const refreshToken = jwt.sign(
        {
            id: user._id,
            sessionId,
            type: 'refresh'
        },
        process.env.JWT_REFRESH_SECRET
    );

    return { accessToken, refreshToken, sessionId, expiresIn: null };
};

const verifyRefreshToken = async (req, res, next) => {
    try {
        const refreshToken = req.body?.refreshToken;
        const auth = await verifyRefreshTokenValue(refreshToken);

        req.user = auth.user;
        req.refreshToken = refreshToken;
        req.auth = auth;
        next();
    } catch (error) {
        return res.status(error.status || 403).json({
            success: false,
            error: error.message || 'Refresh token inválido'
        });
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
