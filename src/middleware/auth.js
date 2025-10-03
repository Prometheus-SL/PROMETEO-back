const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Agent = require('../models/Agent');

// Middleware para verificar JWT
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Token de acceso requerido'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verificar que el usuario existe y está activo
        const user = await User.findById(decoded.id);
        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Usuario no encontrado o inactivo'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expirado'
            });
        }

        return res.status(403).json({
            success: false,
            error: 'Token inválido'
        });
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

        // Buscar agente por API Key
        const agent = await Agent.findOne({ apiKey, isActive: true });
        if (!agent) {
            return res.status(403).json({
                success: false,
                error: 'API Key inválida o agente inactivo'
            });
        }

        // Verificar que el agentId coincida si se proporciona
        if (agentId && agent.agentId !== agentId) {
            return res.status(403).json({
                success: false,
                error: 'Agent ID no coincide'
            });
        }

        // Actualizar última actividad
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
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id);

            if (user && user.isActive) {
                req.user = user;
            }
        }

        next();
    } catch (error) {
        // Continuar sin autenticación si el token es inválido
        next();
    }
};

// Utilidad para generar tokens JWT
const generateTokens = (user) => {
    const accessToken = jwt.sign(
        {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || '15m'
        }
    );

    const refreshToken = jwt.sign(
        { id: user._id },
        process.env.JWT_REFRESH_SECRET,
        {
            expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
        }
    );

    return { accessToken, refreshToken };
};

// Middleware para verificar refresh token
const verifyRefreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                error: 'Refresh token requerido'
            });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const user = await User.findById(decoded.id);

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Usuario no encontrado o inactivo'
            });
        }

        // Verificar que el refresh token esté en la lista del usuario
        const tokenExists = user.refreshTokens.some(
            tokenObj => tokenObj.token === refreshToken
        );

        if (!tokenExists) {
            return res.status(403).json({
                success: false,
                error: 'Refresh token inválido'
            });
        }

        req.user = user;
        req.refreshToken = refreshToken;
        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            error: 'Refresh token inválido o expirado'
        });
    }
};

module.exports = {
    authenticateToken,
    authorizeRole,
    authenticateAgent,
    optionalAuth,
    generateTokens,
    verifyRefreshToken
};