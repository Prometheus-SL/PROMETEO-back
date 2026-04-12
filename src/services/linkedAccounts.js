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
    if (configuredOrigins.length === 0) return true;
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
            'LINKED_ACCOUNTS_ENCRYPTION_KEY no esta configurado.'
        );
    }

    return secret;
}

function getEncryptionKey() {
    return crypto.createHash('sha256').update(getEncryptionSecret()).digest();
}

function encryptLinkedAccountPayload(payload) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);

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
        version: 1,
    };
}

function decryptLinkedAccountPayload(payload) {
    if (!payload?.iv || !payload?.tag || !payload?.ciphertext) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNTS_CREDENTIALS_INVALID',
            'Las credenciales cifradas de la cuenta vinculada no son validas.'
        );
    }

    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            getEncryptionKey(),
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
            'No se pudieron descifrar las credenciales de la cuenta vinculada.'
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
        displayName: profile.displayName || profile.globalName || profile.username || null,
        username: profile.username || null,
        avatarUrl: profile.avatarUrl || null,
        connectedAt: discord?.connectedAt || null,
        scopes: Array.isArray(discord?.scopes) ? discord.scopes : [],
        lastError: discord?.lastError || null,
        email: profile.email || null,
        verified: typeof profile.verified === 'boolean' ? profile.verified : null,
    };
}

function serializeLinkedAccounts(linkedAccounts) {
    return {
        spotify: serializeSpotifyLinkedAccount(linkedAccounts?.spotify),
        discord: serializeDiscordLinkedAccount(linkedAccounts?.discord),
    };
}

function signLinkedAccountState(payload) {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
        throw createLinkedAccountError(
            500,
            'LINKED_ACCOUNT_STATE_NOT_CONFIGURED',
            'JWT_SECRET no esta configurado para firmar el estado OAuth.'
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
            'JWT_SECRET no esta configurado para validar el estado OAuth.'
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
            'El enlace de vinculacion ha caducado o no es valido.'
        );
    }
}

function sanitizeCallbackErrorMessage(error) {
    const message = String(error || 'Se produjo un error al vincular la cuenta.');
    return message.slice(0, 180);
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
    resolveReturnOrigin,
    serializeDiscordLinkedAccount,
    serializeLinkedAccounts,
    serializeSpotifyLinkedAccount,
    serializeUserSummary,
    signLinkedAccountState,
    verifyLinkedAccountState,
};
