const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const validator = require('validator');

const MAX_ACTIVE_SESSIONS = 20;

function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshTokenMatches(storedToken, candidateToken) {
    if (!storedToken || !candidateToken) return false;
    const candidateHash = hashRefreshToken(candidateToken);
    try {
        return crypto.timingSafeEqual(
            Buffer.from(storedToken, 'utf8'),
            Buffer.from(candidateHash, 'utf8')
        );
    } catch (_error) {
        // Length mismatch means legacy plaintext token — compare directly
        return storedToken === candidateToken;
    }
}

function hasOAuthProvider(document) {
    return Array.isArray(document?.oauthProviders) && document.oauthProviders.length > 0;
}

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

const steamProfileSchema = new mongoose.Schema({
    steamId: {
        type: String,
        trim: true,
    },
    personaName: {
        type: String,
        trim: true,
    },
    displayName: {
        type: String,
        trim: true,
    },
    avatarUrl: {
        type: String,
        trim: true,
    },
    profileUrl: {
        type: String,
        trim: true,
    },
    visibilityState: {
        type: Number,
        default: null,
    },
}, { _id: false });

const steamLinkedAccountSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['disconnected', 'connected', 'reauth_required'],
        default: 'disconnected',
    },
    profile: {
        type: steamProfileSchema,
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
    steam: {
        type: steamLinkedAccountSchema,
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
        required() {
            return !hasOAuthProvider(this);
        },
        minlength: [12, 'Password debe tener al menos 12 caracteres'],
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
    avatarUrl: {
        type: String,
        default: null,
    },
    avatarUpdatedAt: {
        type: Date,
        default: null,
    },
    avatarData: {
        type: Buffer,
        default: null,
        select: false,
    },
    birthday: {
        type: Date,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    emailVerified: {
        type: Boolean,
        default: false,
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
    twoFactor: {
        enabled: { type: Boolean, default: false },
        secret: { type: String, select: false },
        recoveryCodes: { type: [String], select: false, default: [] },
        enabledAt: { type: Date, default: null },
    },
    oauthProviders: [{
        provider: {
            type: String,
            enum: ['google', 'github', 'discord'],
            required: true,
        },
        providerId: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
        },
        connectedAt: {
            type: Date,
            default: Date.now,
        },
    }],
}, {
    timestamps: true,
});

userSchema.pre('save', async function () {
    if (!this.isModified('password') || !this.password) return;

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.statics.findByOAuthProvider = function (provider, providerId) {
    return this.findOne({
        'oauthProviders.provider': provider,
        'oauthProviders.providerId': providerId,
        isActive: true,
    });
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
        token: hashRefreshToken(refreshToken),
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
        return refreshTokenMatches(session.token, refreshToken);
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
    this.refreshTokens = this.refreshTokens.filter(
        (session) => !refreshTokenMatches(session?.token, refreshToken)
    );
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

    if (provider === 'steam') {
        this.linkedAccounts = this.linkedAccounts || {};
        this.linkedAccounts.steam = {
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
    if (user.linkedAccounts?.steam) {
        delete user.linkedAccounts.steam.credentials;
    }
    delete user.linkedAccounts;
    return user;
};

module.exports = mongoose.model('User', userSchema);
