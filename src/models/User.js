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
        default: Date.now,
    },
    lastUsedAt: {
        type: Date,
        default: Date.now,
    },
    userAgent: {
        type: String,
        trim: true,
    },
    ip: {
        type: String,
        trim: true,
    },
}, { _id: false });

const encryptedPayloadSchema = new mongoose.Schema({
    alg: {
        type: String,
        default: 'aes-256-gcm',
    },
    iv: {
        type: String,
        trim: true,
    },
    tag: {
        type: String,
        trim: true,
    },
    ciphertext: {
        type: String,
        trim: true,
    },
    version: {
        type: Number,
        default: 1,
    },
}, { _id: false });

const spotifyProfileSchema = new mongoose.Schema({
    id: {
        type: String,
        trim: true,
    },
    displayName: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    avatarUrl: {
        type: String,
        trim: true,
    },
    product: {
        type: String,
        trim: true,
    },
    externalUrl: {
        type: String,
        trim: true,
    },
}, { _id: false });

const spotifyLinkedAccountSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['disconnected', 'connected', 'reauth_required'],
        default: 'disconnected',
    },
    profile: {
        type: spotifyProfileSchema,
        default: undefined,
    },
    scopes: {
        type: [String],
        default: [],
    },
    connectedAt: {
        type: Date,
        default: null,
    },
    tokenExpiresAt: {
        type: Date,
        default: null,
    },
    lastError: {
        type: String,
        default: null,
    },
    credentials: {
        type: encryptedPayloadSchema,
        default: undefined,
    },
}, { _id: false });

const discordProfileSchema = new mongoose.Schema({
    id: {
        type: String,
        trim: true,
    },
    username: {
        type: String,
        trim: true,
    },
    globalName: {
        type: String,
        trim: true,
    },
    displayName: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    avatarUrl: {
        type: String,
        trim: true,
    },
    locale: {
        type: String,
        trim: true,
    },
    verified: {
        type: Boolean,
        default: null,
    },
}, { _id: false });

const discordEpicNotificationEntrySchema = new mongoose.Schema({
    guildId: {
        type: String,
        trim: true,
        required: true,
    },
    channelId: {
        type: String,
        trim: true,
        default: null,
    },
    enabled: {
        type: Boolean,
        default: false,
    },
    lastNotifiedIds: {
        type: [String],
        default: [],
    },
    lastNotifiedAt: {
        type: Date,
        default: null,
    },
    lastError: {
        type: String,
        default: null,
    },
}, { _id: false });

const discordNotificationsSchema = new mongoose.Schema({
    epicFreeGames: {
        type: [discordEpicNotificationEntrySchema],
        default: () => [],
    },
}, { _id: false });

const discordLinkedAccountSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['disconnected', 'connected', 'reauth_required'],
        default: 'disconnected',
    },
    profile: {
        type: discordProfileSchema,
        default: undefined,
    },
    scopes: {
        type: [String],
        default: [],
    },
    connectedAt: {
        type: Date,
        default: null,
    },
    tokenExpiresAt: {
        type: Date,
        default: null,
    },
    lastError: {
        type: String,
        default: null,
    },
    credentials: {
        type: encryptedPayloadSchema,
        default: undefined,
    },
    notifications: {
        type: discordNotificationsSchema,
        default: () => ({ epicFreeGames: [] }),
    },
}, { _id: false });

const googleProfileSchema = new mongoose.Schema({
    id: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    displayName: {
        type: String,
        trim: true,
    },
    avatarUrl: {
        type: String,
        trim: true,
    },
    locale: {
        type: String,
        trim: true,
    },
}, { _id: false });

const googleLinkedAccountSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['disconnected', 'connected', 'reauth_required'],
        default: 'disconnected',
    },
    profile: {
        type: googleProfileSchema,
        default: undefined,
    },
    scopes: {
        type: [String],
        default: [],
    },
    connectedAt: {
        type: Date,
        default: null,
    },
    tokenExpiresAt: {
        type: Date,
        default: null,
    },
    lastError: {
        type: String,
        default: null,
    },
    credentials: {
        type: encryptedPayloadSchema,
        default: undefined,
    },
}, { _id: false });

const githubProfileSchema = new mongoose.Schema({
    id: {
        type: String,
        trim: true,
    },
    login: {
        type: String,
        trim: true,
    },
    displayName: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
    },
    avatarUrl: {
        type: String,
        trim: true,
    },
    htmlUrl: {
        type: String,
        trim: true,
    },
}, { _id: false });

const githubLinkedAccountSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['disconnected', 'connected', 'reauth_required'],
        default: 'disconnected',
    },
    profile: {
        type: githubProfileSchema,
        default: undefined,
    },
    scopes: {
        type: [String],
        default: [],
    },
    connectedAt: {
        type: Date,
        default: null,
    },
    tokenExpiresAt: {
        type: Date,
        default: null,
    },
    lastError: {
        type: String,
        default: null,
    },
    credentials: {
        type: encryptedPayloadSchema,
        default: undefined,
    },
}, { _id: false });

const linkedAccountsSchema = new mongoose.Schema({
    spotify: {
        type: spotifyLinkedAccountSchema,
        default: () => ({ status: 'disconnected', scopes: [] }),
    },
    discord: {
        type: discordLinkedAccountSchema,
        default: () => ({ status: 'disconnected', scopes: [] }),
    },
    google: {
        type: googleLinkedAccountSchema,
        default: () => ({ status: 'disconnected', scopes: [] }),
    },
    github: {
        type: githubLinkedAccountSchema,
        default: () => ({ status: 'disconnected', scopes: [] }),
    },
}, { _id: false });

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username es requerido'],
        unique: true,
        trim: true,
        minlength: [3, 'Username debe tener al menos 3 caracteres'],
        maxlength: [30, 'Username no puede exceder 30 caracteres'],
    },
    email: {
        type: String,
        required: [true, 'Email es requerido'],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail, 'Email invalido'],
    },
    password: {
        type: String,
        required: [true, 'Password es requerido'],
        minlength: [6, 'Password debe tener al menos 6 caracteres'],
        select: false,
    },
    role: {
        type: String,
        enum: ['admin', 'operator', 'viewer', 'user'],
        default: 'user',
    },
    name: {
        type: String,
        trim: true,
        maxlength: [50, 'Name no puede exceder 50 caracteres'],
    },
    surname: {
        type: String,
        trim: true,
        maxlength: [50, 'Surname no puede exceder 50 caracteres'],
    },
    birthday: {
        type: Date,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    lastLogin: {
        type: Date,
    },
    tokenInvalidBefore: {
        type: Date,
        default: null,
    },
    refreshTokens: {
        type: [sessionSchema],
        default: [],
    },
    linkedAccounts: {
        type: linkedAccountsSchema,
        default: () => ({}),
    },
}, {
    timestamps: true,
});

userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.registerSession = function ({
    sessionId,
    refreshToken,
    userAgent = null,
    ip = null,
    createdAt = new Date(),
}) {
    if (!refreshToken) {
        throw new Error('refreshToken es requerido para registrar la sesion');
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

userSchema.methods.clearLinkedAccount = function (provider) {
    if (!provider) return this;

    if (provider === 'spotify') {
        this.linkedAccounts = this.linkedAccounts || {};
        this.linkedAccounts.spotify = {
            status: 'disconnected',
            profile: undefined,
            scopes: [],
            connectedAt: null,
            tokenExpiresAt: null,
            lastError: null,
            credentials: undefined,
        };
    }

    if (provider === 'discord') {
        this.linkedAccounts = this.linkedAccounts || {};
        this.linkedAccounts.discord = {
            status: 'disconnected',
            profile: undefined,
            scopes: [],
            connectedAt: null,
            tokenExpiresAt: null,
            lastError: null,
            credentials: undefined,
            notifications: { epicFreeGames: [] },
        };
    }

    if (provider === 'google') {
        this.linkedAccounts = this.linkedAccounts || {};
        this.linkedAccounts.google = {
            status: 'disconnected',
            profile: undefined,
            scopes: [],
            connectedAt: null,
            tokenExpiresAt: null,
            lastError: null,
            credentials: undefined,
        };
    }

    if (provider === 'github') {
        this.linkedAccounts = this.linkedAccounts || {};
        this.linkedAccounts.github = {
            status: 'disconnected',
            profile: undefined,
            scopes: [],
            connectedAt: null,
            tokenExpiresAt: null,
            lastError: null,
            credentials: undefined,
        };
    }

    return this;
};

userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.refreshTokens;
    delete user.tokenInvalidBefore;
    if (user.linkedAccounts?.spotify) {
        delete user.linkedAccounts.spotify.credentials;
    }
    if (user.linkedAccounts?.discord) {
        delete user.linkedAccounts.discord.credentials;
    }
    if (user.linkedAccounts?.google) {
        delete user.linkedAccounts.google.credentials;
    }
    if (user.linkedAccounts?.github) {
        delete user.linkedAccounts.github.credentials;
    }
    delete user.linkedAccounts;
    return user;
};

module.exports = mongoose.model('User', userSchema);
