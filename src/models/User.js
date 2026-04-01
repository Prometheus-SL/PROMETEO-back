const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const MAX_ACTIVE_SESSIONS = 20;

const sessionSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
    },
    sessionId: {
        type: String,
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUsedAt: {
        type: Date,
        default: Date.now
    },
    userAgent: {
        type: String,
        trim: true
    },
    ip: {
        type: String,
        trim: true
    }
}, { _id: false });

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username es requerido'],
        unique: true,
        trim: true,
        minlength: [3, 'Username debe tener al menos 3 caracteres'],
        maxlength: [30, 'Username no puede exceder 30 caracteres']
    },
    email: {
        type: String,
        required: [true, 'Email es requerido'],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail, 'Email inválido']
    },
    password: {
        type: String,
        required: [true, 'Password es requerido'],
        minlength: [6, 'Password debe tener al menos 6 caracteres'],
        select: false // No incluir password en consultas por defecto
    },
    role: {
        type: String,
        enum: ['admin', 'operator', 'viewer', 'user'],
        default: 'user'
    },
    name: {
        type: String,
        trim: true,
        maxlength: [50, 'Name no puede exceder 50 caracteres']
    },
    surname: {
        type: String,
        trim: true,
        maxlength: [50, 'Surname no puede exceder 50 caracteres']
    },
    birthday: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    tokenInvalidBefore: {
        type: Date,
        default: null
    },
    refreshTokens: {
        type: [sessionSchema],
        default: []
    }
}, {
    timestamps: true
});

// Middleware para hash de password antes de guardar
userSchema.pre('save', async function (next) {
    // Solo hash si password fue modificado
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Método para comparar passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Registra o actualiza una sesión activa para que el access token pueda revocarse.
userSchema.methods.registerSession = function ({
    sessionId,
    refreshToken,
    userAgent = null,
    ip = null,
    createdAt = new Date(),
}) {
    if (!refreshToken) {
        throw new Error('refreshToken es requerido para registrar la sesión');
    }

    const currentSessions = Array.isArray(this.refreshTokens) ? this.refreshTokens : [];
    const nextSessions = currentSessions.filter((session) => {
        if (!session) return false;
        if (sessionId && session.sessionId === sessionId) return false;
        return session.token !== refreshToken;
    });

    nextSessions.push({
        token: refreshToken,
        sessionId: sessionId || undefined,
        createdAt,
        lastUsedAt: createdAt,
        userAgent: userAgent || undefined,
        ip: ip || undefined,
    });

    nextSessions.sort((a, b) => {
        const left = new Date(b.lastUsedAt || b.createdAt || 0).getTime();
        const right = new Date(a.lastUsedAt || a.createdAt || 0).getTime();
        return left - right;
    });

    this.refreshTokens = nextSessions.slice(0, MAX_ACTIVE_SESSIONS);
    return this;
};

userSchema.methods.hasSession = function (sessionId) {
    if (!sessionId) return false;
    return this.refreshTokens.some((session) => session?.sessionId === sessionId);
};

userSchema.methods.hasRefreshToken = function (refreshToken, sessionId = null) {
    if (!refreshToken) return false;
    return this.refreshTokens.some((session) => {
        if (!session) return false;
        if (sessionId && session.sessionId !== sessionId) return false;
        return session.token === refreshToken;
    });
};

userSchema.methods.touchSession = function (sessionId) {
    if (!sessionId) return this;
    const session = this.refreshTokens.find((item) => item?.sessionId === sessionId);
    if (session) {
        session.lastUsedAt = new Date();
    }
    return this;
};

userSchema.methods.removeSessionBySessionId = function (sessionId) {
    if (!sessionId) return this;
    this.refreshTokens = this.refreshTokens.filter((session) => session?.sessionId !== sessionId);
    return this;
};

userSchema.methods.removeSessionByRefreshToken = function (refreshToken) {
    if (!refreshToken) return this;
    this.refreshTokens = this.refreshTokens.filter((session) => session?.token !== refreshToken);
    return this;
};

userSchema.methods.revokeAllSessions = function () {
    this.refreshTokens = [];
    this.tokenInvalidBefore = new Date();
    return this;
};

// Método para obtener usuario sin datos sensibles
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.refreshTokens;
    delete user.tokenInvalidBefore;
    return user;
};

module.exports = mongoose.model('User', userSchema);
