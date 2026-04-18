const crypto = require('crypto');
const {
    createLinkedAccountError,
    decryptLinkedAccountPayload,
    encryptLinkedAccountPayload,
    resolveReturnOrigin,
    serializeDiscordLinkedAccount,
    signLinkedAccountState,
} = require('./linkedAccounts');

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = `${DISCORD_API_BASE_URL}/oauth2/token`;
const DISCORD_SCOPES = ['identify', 'email', 'guilds'];

function assertDiscordConfigured() {
    const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
    const redirectUri = String(process.env.DISCORD_REDIRECT_URI || '').trim();

    if (!clientId || !clientSecret || !redirectUri) {
        throw createLinkedAccountError(
            500,
            'DISCORD_NOT_CONFIGURED',
            'Discord is not configured in the backend.'
        );
    }

    return { clientId, clientSecret, redirectUri };
}

function getMutableDiscordAccount(user) {
    user.linkedAccounts = user.linkedAccounts || {};
    if (!user.linkedAccounts.discord) {
        user.linkedAccounts.discord = {
            status: 'disconnected',
            scopes: [],
        };
    }
    return user.linkedAccounts.discord;
}

function getGrantedScopes(scopeValue, fallback = []) {
    const nextScopes = String(scopeValue || '')
        .split(' ')
        .map((entry) => entry.trim())
        .filter(Boolean);

    if (nextScopes.length > 0) {
        return Array.from(new Set(nextScopes));
    }

    return Array.from(new Set(Array.isArray(fallback) ? fallback : []));
}

function buildDiscordAvatarUrl(profile) {
    if (!profile?.id) return null;
    if (profile.avatar) {
        const ext = profile.avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}?size=256`;
    }
    const discriminator = Number(profile.discriminator || '0');
    const index = Number.isFinite(discriminator) && discriminator > 0
        ? discriminator % 5
        : Number((BigInt(profile.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function serializeDiscordProfile(profile) {
    return {
        id: profile?.id || null,
        username: profile?.username || null,
        globalName: profile?.global_name || profile?.globalName || null,
        displayName:
            profile?.global_name ||
            profile?.globalName ||
            profile?.username ||
            null,
        email: profile?.email || null,
        avatarUrl: buildDiscordAvatarUrl(profile),
        locale: profile?.locale || null,
        verified: typeof profile?.verified === 'boolean' ? profile.verified : null,
    };
}

async function parseDiscordResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 204) {
        return null;
    }

    if (contentType.includes('application/json')) {
        try {
            return await response.json();
        } catch (_error) {
            return null;
        }
    }

    try {
        return await response.text();
    } catch (_error) {
        return null;
    }
}

function getDiscordErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    if (typeof payload?.error_description === 'string' && payload.error_description.trim()) {
        return payload.error_description.trim();
    }

    if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }

    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    return fallback;
}

function createDiscordApiError(response, payload) {
    const message = getDiscordErrorMessage(payload, `Discord returned error ${response.status}.`);

    if (response.status === 401) {
        return createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Discord needs you to link your account again.',
            payload
        );
    }

    return createLinkedAccountError(
        502,
        'DISCORD_API_ERROR',
        message,
        payload
    );
}

async function requestDiscordToken(params) {
    const { clientId, clientSecret, redirectUri } = assertDiscordConfigured();
    const body = new URLSearchParams();

    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            body.set(key, String(value));
        }
    }

    if (params.grant_type === 'authorization_code' && !body.has('redirect_uri')) {
        body.set('redirect_uri', redirectUri);
    }

    const response = await fetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    const payload = await parseDiscordResponse(response);

    if (!response.ok) {
        if (response.status === 400 && payload?.error === 'invalid_grant') {
            throw createLinkedAccountError(
                412,
                'REAUTH_REQUIRED',
                'The Discord link has expired and must be reconnected.',
                payload
            );
        }

        throw createDiscordApiError(response, payload);
    }

    return payload;
}

async function fetchDiscordProfile(accessToken) {
    const response = await fetch(`${DISCORD_API_BASE_URL}/users/@me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const payload = await parseDiscordResponse(response);

    if (!response.ok) {
        throw createDiscordApiError(response, payload);
    }

    return payload;
}

function readDiscordCredentials(user) {
    const discord = user?.linkedAccounts?.discord;
    if (!discord?.credentials) {
        return null;
    }

    return decryptLinkedAccountPayload(discord.credentials);
}

function persistDiscordTokens(user, tokenPayload, profile, options = {}) {
    const discord = getMutableDiscordAccount(user);
    const currentCredentials = readDiscordCredentials(user) || {};
    const refreshToken = tokenPayload.refresh_token || currentCredentials.refreshToken;

    if (!refreshToken) {
        throw createLinkedAccountError(
            502,
            'DISCORD_REFRESH_TOKEN_MISSING',
            'Discord did not return a usable refresh token.'
        );
    }

    discord.status = 'connected';
    discord.profile = serializeDiscordProfile(profile || discord.profile || {});
    discord.scopes = getGrantedScopes(tokenPayload.scope, discord.scopes);
    discord.connectedAt =
        options.touchConnectedAt || !discord.connectedAt
            ? new Date()
            : discord.connectedAt;
    discord.tokenExpiresAt = new Date(Date.now() + (Number(tokenPayload.expires_in) || 3600) * 1000);
    discord.lastError = null;
    discord.credentials = encryptLinkedAccountPayload({
        accessToken: tokenPayload.access_token,
        refreshToken,
        scope: tokenPayload.scope || discord.scopes.join(' '),
        tokenType: tokenPayload.token_type || 'Bearer',
    });

    return discord;
}

async function markDiscordReauthRequired(user, reason) {
    const discord = getMutableDiscordAccount(user);
    discord.status = 'reauth_required';
    discord.tokenExpiresAt = null;
    discord.lastError = reason || 'Discord needs you to link your account again.';
    discord.credentials = undefined;
    await user.save();
    return discord;
}

function buildDiscordAuthorizeUrl(user, sessionId, req) {
    const { clientId, redirectUri } = assertDiscordConfigured();
    const returnOrigin = resolveReturnOrigin(req);

    const state = signLinkedAccountState({
        provider: 'discord',
        userId: String(user._id),
        sessionId,
        returnOrigin,
        nonce: crypto.randomUUID(),
    });

    const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', DISCORD_SCOPES.join(' '));
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('prompt', 'consent');

    return authorizeUrl.toString();
}

async function completeDiscordLink(user, code) {
    const tokenPayload = await requestDiscordToken({
        grant_type: 'authorization_code',
        code,
    });

    const profile = await fetchDiscordProfile(tokenPayload.access_token);
    persistDiscordTokens(user, tokenPayload, profile, { touchConnectedAt: true });
    await user.save();
    return serializeDiscordLinkedAccount(user.linkedAccounts?.discord);
}

async function refreshDiscordAccessToken(user) {
    const credentials = readDiscordCredentials(user);
    if (!credentials?.refreshToken) {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Discord needs you to link your account again.'
        );
    }
    const tokenPayload = await requestDiscordToken({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
    });
    persistDiscordTokens(user, tokenPayload, null);
    await user.save();
    return readDiscordCredentials(user);
}

async function getValidDiscordAccessToken(user) {
    const discord = user?.linkedAccounts?.discord;
    if (discord?.status !== 'connected') {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Discord needs you to link your account again.'
        );
    }
    const credentials = readDiscordCredentials(user);
    if (!credentials?.accessToken) {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Discord needs you to link your account again.'
        );
    }
    const expiresAt = discord.tokenExpiresAt ? new Date(discord.tokenExpiresAt).getTime() : 0;
    if (expiresAt && expiresAt < Date.now() + 60_000) {
        const refreshed = await refreshDiscordAccessToken(user);
        return refreshed?.accessToken || credentials.accessToken;
    }
    return credentials.accessToken;
}

async function fetchDiscordUserGuilds(accessToken) {
    const response = await fetch(`${DISCORD_API_BASE_URL}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await parseDiscordResponse(response);
    if (!response.ok) {
        throw createDiscordApiError(response, payload);
    }
    return Array.isArray(payload) ? payload : [];
}

async function disconnectDiscordAccount(user) {
    user.clearLinkedAccount('discord');
    await user.save();
    return serializeDiscordLinkedAccount(user.linkedAccounts?.discord);
}

async function getDiscordStatus(user) {
    assertDiscordConfigured();
    return serializeDiscordLinkedAccount(user?.linkedAccounts?.discord);
}

module.exports = {
    DISCORD_SCOPES,
    buildDiscordAuthorizeUrl,
    completeDiscordLink,
    disconnectDiscordAccount,
    fetchDiscordUserGuilds,
    getDiscordStatus,
    getValidDiscordAccessToken,
    markDiscordReauthRequired,
    refreshDiscordAccessToken,
};
