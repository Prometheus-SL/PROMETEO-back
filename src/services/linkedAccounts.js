const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class LinkedAccountError extends Error {
    constructor(status, code, message, details, headers) {
        super(message);
        this.name = 'LinkedAccountError';
        this.status = status;
        this.code = code;
        this.details = details;
        this.headers = headers;
    }
}

function createLinkedAccountError(status, code, message, details, headers) {
    return new LinkedAccountError(status, code, message, details, headers);
}

function normalizeOrigin(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
        }
        return `${url.protocol}//${url.host}`;
    } catch (_error) {
        return null;
    }
}

function getConfiguredOrigins() {
    return String(process.env.CORS_ORIGINS || process.env.CLIENT_URL || '')
        .split(',')
        .map((entry) => normalizeOrigin(entry))
        .filter(Boolean);
}

function isAllowedOrigin(origin) {
    const configuredOrigins = getConfiguredOrigins();
    if (!origin) return false;
    if (configuredOrigins.length === 0) return false;
    return configuredOrigins.includes(origin);
}

function getDefaultClientOrigin() {
    return getConfiguredOrigins()[0] || 'http://localhost:5173';
}

function resolveReturnOrigin(req) {
    const headerOrigin = normalizeOrigin(req.get('origin') || req.get('Origin'));
    if (headerOrigin && isAllowedOrigin(headerOrigin)) {
        return headerOrigin;
    }

    const bodyOrigin = normalizeOrigin(req.body?.returnOrigin);
    if (bodyOrigin && isAllowedOrigin(bodyOrigin)) {
        return bodyOrigin;
    }

    return getDefaultClientOrigin();
}

function getEncryptionSecret() {
    const secret = String(process.env.LINKED_ACCOUNTS_ENCRYPTION_KEY || '').trim();
    if (!secret) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNTS_NOT_CONFIGURED',
            'LINKED_ACCOUNTS_ENCRYPTION_KEY is not configured.'
        );
    }

    return secret;
}

function getEncryptionKey() {
    return crypto.createHash('sha256').update(getEncryptionSecret()).digest();
}

const PBKDF2_SALT = 'prometeo-linked-accounts-v2';
const PBKDF2_ITERATIONS = 100_000;

function getEncryptionKeyV2() {
    return crypto.pbkdf2Sync(
        getEncryptionSecret(),
        PBKDF2_SALT,
        PBKDF2_ITERATIONS,
        32,
        'sha512'
    );
}

function encryptLinkedAccountPayload(payload) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKeyV2(), iv);

    const plaintext = JSON.stringify(payload);
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);

    return {
        alg: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        version: 2,
    };
}

function decryptLinkedAccountPayload(payload) {
    if (!payload?.iv || !payload?.tag || !payload?.ciphertext) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNTS_CREDENTIALS_INVALID',
            'The encrypted linked account credentials are invalid.'
        );
    }

    const version = payload.version || 1;
    const key = version >= 2 ? getEncryptionKeyV2() : getEncryptionKey();

    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(payload.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(payload.ciphertext, 'base64')),
            decipher.final(),
        ]);

        return JSON.parse(plaintext.toString('utf8'));
    } catch (_error) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNTS_CREDENTIALS_INVALID',
            'The linked account credentials could not be decrypted.'
        );
    }
}

function serializeUserSummary(user) {
    return {
        id: String(user._id),
        username: user.username,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
        name: user.name,
        surname: user.surname,
        birthday: user.birthday,
    };
}

function serializeSpotifyLinkedAccount(spotify) {
    const status = spotify?.status || 'disconnected';
    const profile = spotify?.profile || {};

    return {
        status,
        displayName: profile.displayName || null,
        avatarUrl: profile.avatarUrl || null,
        connectedAt: spotify?.connectedAt || null,
        scopes: Array.isArray(spotify?.scopes) ? spotify.scopes : [],
        tokenExpiresAt: spotify?.tokenExpiresAt || null,
        lastError: spotify?.lastError || null,
        product: profile.product || null,
        externalUrl: profile.externalUrl || null,
    };
}

function serializeDiscordLinkedAccount(discord) {
    const status = discord?.status || 'disconnected';
    const profile = discord?.profile || {};

    return {
        status,
        id: profile.id || null,
        displayName: profile.displayName || profile.globalName || profile.username || null,
        username: profile.username || null,
        avatarUrl: profile.avatarUrl || null,
        connectedAt: discord?.connectedAt || null,
        scopes: Array.isArray(discord?.scopes) ? discord.scopes : [],
        tokenExpiresAt: discord?.tokenExpiresAt || null,
        lastError: discord?.lastError || null,
        email: profile.email || null,
        verified: typeof profile.verified === 'boolean' ? profile.verified : null,
    };
}

function serializeGenericLinkedAccount(account) {
    const profile = account?.profile || {};

    return {
        status: account?.status || 'disconnected',
        profile: Object.keys(profile).length > 0 ? profile : null,
        connectedAt: account?.connectedAt || null,
        scopes: Array.isArray(account?.scopes) ? account.scopes : [],
        tokenExpiresAt: account?.tokenExpiresAt || null,
        lastError: account?.lastError || null,
    };
}

function serializeLinkedAccounts(linkedAccounts) {
    return {
        spotify: serializeSpotifyLinkedAccount(linkedAccounts?.spotify),
        discord: serializeDiscordLinkedAccount(linkedAccounts?.discord),
        google: serializeGenericLinkedAccount(linkedAccounts?.google),
        github: serializeGenericLinkedAccount(linkedAccounts?.github),
    };
}

function signLinkedAccountState(payload) {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNT_STATE_NOT_CONFIGURED',
            'JWT_SECRET is not configured to sign the OAuth state.'
        );
    }

    return jwt.sign(
        {
            ...payload,
            type: 'linked-account-oauth',
        },
        secret,
        { expiresIn: '10m' }
    );
}

function verifyLinkedAccountState(token) {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNT_STATE_NOT_CONFIGURED',
            'JWT_SECRET is not configured to validate the OAuth state.'
        );
    }

    try {
        const decoded = jwt.verify(String(token || ''), secret);
        if (decoded?.type !== 'linked-account-oauth') {
            throw new Error('invalid type');
        }
        return decoded;
    } catch (_error) {
        throw createLinkedAccountError(
            400,
            'LINKED_ACCOUNT_STATE_INVALID',
            'The account linking URL has expired or is invalid.'
        );
    }
}

function sanitizeCallbackErrorMessage(error) {
    const message = String(error || 'An error occurred while linking the account.');
    return message.slice(0, 180);
}

function peekOAuthStateType(token) {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) return null;
    try {
        const decoded = jwt.verify(String(token || ''), secret);
        return decoded?.type || null;
    } catch {
        return null;
    }
}

function buildLinkedAccountCallbackUrl({ origin, provider, status, error }) {
    const callbackUrl = new URL('/linked-account-callback', origin || getDefaultClientOrigin());
    callbackUrl.searchParams.set('provider', provider);
    callbackUrl.searchParams.set('status', status);
    if (error) {
        callbackUrl.searchParams.set('error', sanitizeCallbackErrorMessage(error));
    }
    return callbackUrl.toString();
}

module.exports = {
    LinkedAccountError,
    buildLinkedAccountCallbackUrl,
    createLinkedAccountError,
    decryptLinkedAccountPayload,
    encryptLinkedAccountPayload,
    getDefaultClientOrigin,
    normalizeOrigin,
    peekOAuthStateType,
    resolveReturnOrigin,
    serializeDiscordLinkedAccount,
    serializeGenericLinkedAccount,
    serializeLinkedAccounts,
    serializeSpotifyLinkedAccount,
    serializeUserSummary,
    signLinkedAccountState,
    verifyLinkedAccountState,
};
