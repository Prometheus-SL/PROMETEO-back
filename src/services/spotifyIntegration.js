const crypto = require('crypto');
const {
    createLinkedAccountError,
    decryptLinkedAccountPayload,
    encryptLinkedAccountPayload,
    resolveReturnOrigin,
    serializeSpotifyLinkedAccount,
    signLinkedAccountState,
} = require('./linkedAccounts');

const SPOTIFY_ACCOUNTS_BASE_URL = 'https://accounts.spotify.com';
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_SCOPES = [
    'user-read-private',
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-modify-playback-state',
];

function assertSpotifyConfigured() {
    const clientId = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    const redirectUri = String(process.env.SPOTIFY_REDIRECT_URI || '').trim();

    if (!clientId || !clientSecret || !redirectUri) {
        throw createLinkedAccountError(
            500,
            'SPOTIFY_NOT_CONFIGURED',
            'Spotify no esta configurado en el backend.'
        );
    }

    return { clientId, clientSecret, redirectUri };
}

function createSpotifyAuthHeader() {
    const { clientId, clientSecret } = assertSpotifyConfigured();
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function getMutableSpotifyAccount(user) {
    user.linkedAccounts = user.linkedAccounts || {};
    if (!user.linkedAccounts.spotify) {
        user.linkedAccounts.spotify = {
            status: 'disconnected',
            scopes: [],
        };
    }
    return user.linkedAccounts.spotify;
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

function serializeSpotifyProfile(profile) {
    return {
        id: profile?.id || null,
        displayName: profile?.display_name || profile?.displayName || profile?.id || null,
        email: profile?.email || null,
        avatarUrl: profile?.images?.[0]?.url || profile?.avatarUrl || null,
        product: profile?.product || null,
        externalUrl: profile?.external_urls?.spotify || profile?.externalUrl || null,
    };
}

async function parseSpotifyResponse(response) {
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

function getSpotifyErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    const spotifyError = payload?.error;
    if (typeof spotifyError === 'string' && spotifyError.trim()) {
        return spotifyError.trim();
    }

    if (spotifyError && typeof spotifyError === 'object') {
        if (typeof spotifyError.message === 'string' && spotifyError.message.trim()) {
            return spotifyError.message.trim();
        }
        if (typeof spotifyError.reason === 'string' && spotifyError.reason.trim()) {
            return spotifyError.reason.trim();
        }
    }

    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    return fallback;
}

function createSpotifyApiError(response, payload) {
    const message = getSpotifyErrorMessage(payload, `Spotify devolvio un error ${response.status}.`);
    const retryAfter = response.headers.get('retry-after');

    if (response.status === 429) {
        return createLinkedAccountError(
            429,
            'SPOTIFY_RATE_LIMITED',
            message,
            payload,
            retryAfter ? { 'Retry-After': retryAfter } : undefined
        );
    }

    if (
        response.status === 403 &&
        /premium/i.test(message)
    ) {
        return createLinkedAccountError(
            409,
            'SPOTIFY_PREMIUM_REQUIRED',
            'Spotify requiere una cuenta Premium para realizar esta accion.',
            payload
        );
    }

    if (
        response.status === 404 &&
        /no active device/i.test(message)
    ) {
        return createLinkedAccountError(
            409,
            'SPOTIFY_NO_ACTIVE_DEVICE',
            'No hay un dispositivo activo de Spotify para controlar.',
            payload
        );
    }

    if (
        response.status === 403 &&
        (/restriction/i.test(message) || /device/i.test(message))
    ) {
        return createLinkedAccountError(
            409,
            'SPOTIFY_CONTROL_NOT_ALLOWED',
            'Spotify no permite controlar la reproduccion en el estado actual.',
            payload
        );
    }

    if (response.status === 401) {
        return createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Spotify necesita que vuelvas a vincular tu cuenta.',
            payload
        );
    }

    return createLinkedAccountError(
        502,
        'SPOTIFY_API_ERROR',
        message,
        payload
    );
}

async function requestSpotifyToken(params) {
    const { redirectUri } = assertSpotifyConfigured();
    const body = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            body.set(key, String(value));
        }
    }

    if (params.grant_type === 'authorization_code' && !body.has('redirect_uri')) {
        body.set('redirect_uri', redirectUri);
    }

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
        method: 'POST',
        headers: {
            Authorization: createSpotifyAuthHeader(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    const payload = await parseSpotifyResponse(response);

    if (!response.ok) {
        if (response.status === 400 && payload?.error === 'invalid_grant') {
            throw createLinkedAccountError(
                412,
                'REAUTH_REQUIRED',
                'La vinculacion con Spotify ha caducado y debe reconectarse.',
                payload
            );
        }

        throw createSpotifyApiError(response, payload);
    }

    return payload;
}

async function fetchSpotifyProfile(accessToken) {
    const response = await fetch(`${SPOTIFY_API_BASE_URL}/me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const payload = await parseSpotifyResponse(response);

    if (!response.ok) {
        throw createSpotifyApiError(response, payload);
    }

    return payload;
}

function readSpotifyCredentials(user) {
    const spotify = user?.linkedAccounts?.spotify;
    if (!spotify?.credentials) {
        return null;
    }

    return decryptLinkedAccountPayload(spotify.credentials);
}

function persistSpotifyTokens(user, tokenPayload, profile, options = {}) {
    const spotify = getMutableSpotifyAccount(user);
    const currentCredentials = readSpotifyCredentials(user) || {};
    const refreshToken = tokenPayload.refresh_token || currentCredentials.refreshToken;

    if (!refreshToken) {
        throw createLinkedAccountError(
            502,
            'SPOTIFY_REFRESH_TOKEN_MISSING',
            'Spotify no devolvio un refresh token utilizable.'
        );
    }

    spotify.status = 'connected';
    spotify.profile = serializeSpotifyProfile(profile || spotify.profile || {});
    spotify.scopes = getGrantedScopes(tokenPayload.scope, spotify.scopes);
    spotify.connectedAt =
        options.touchConnectedAt || !spotify.connectedAt
            ? new Date()
            : spotify.connectedAt;
    spotify.tokenExpiresAt = new Date(Date.now() + (Number(tokenPayload.expires_in) || 3600) * 1000);
    spotify.lastError = null;
    spotify.credentials = encryptLinkedAccountPayload({
        accessToken: tokenPayload.access_token,
        refreshToken,
        scope: tokenPayload.scope || spotify.scopes.join(' '),
        tokenType: tokenPayload.token_type || 'Bearer',
    });

    return spotify;
}

async function markSpotifyReauthRequired(user, reason) {
    const spotify = getMutableSpotifyAccount(user);
    spotify.status = 'reauth_required';
    spotify.tokenExpiresAt = null;
    spotify.lastError = reason || 'Spotify necesita que vuelvas a vincular la cuenta.';
    spotify.credentials = undefined;
    await user.save();
    return spotify;
}

function assertSpotifyLinked(user) {
    const spotify = user?.linkedAccounts?.spotify;
    if (!spotify || spotify.status === 'disconnected' || !spotify.credentials) {
        throw createLinkedAccountError(
            412,
            'LINKED_ACCOUNT_REQUIRED',
            'Vincula tu cuenta de Spotify desde Account para usar esta integracion.'
        );
    }

    if (spotify.status === 'reauth_required') {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Spotify necesita que vuelvas a vincular la cuenta.'
        );
    }

    return spotify;
}

async function refreshSpotifyAccessToken(user) {
    const spotify = assertSpotifyLinked(user);
    const credentials = readSpotifyCredentials(user);

    if (!credentials?.refreshToken) {
        await markSpotifyReauthRequired(
            user,
            'La vinculacion de Spotify no tiene un refresh token valido.'
        );

        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Spotify necesita que vuelvas a vincular la cuenta.'
        );
    }

    try {
        const payload = await requestSpotifyToken({
            grant_type: 'refresh_token',
            refresh_token: credentials.refreshToken,
        });

        persistSpotifyTokens(user, {
            ...payload,
            refresh_token: payload.refresh_token || credentials.refreshToken,
            scope: payload.scope || spotify.scopes.join(' '),
        }, spotify.profile);

        await user.save();
        return readSpotifyCredentials(user)?.accessToken || payload.access_token;
    } catch (error) {
        if (error.code === 'REAUTH_REQUIRED') {
            await markSpotifyReauthRequired(user, error.message);
        }
        throw error;
    }
}

async function ensureSpotifyAccessToken(user) {
    assertSpotifyConfigured();
    const spotify = assertSpotifyLinked(user);
    const credentials = readSpotifyCredentials(user);

    if (!credentials?.accessToken) {
        return refreshSpotifyAccessToken(user);
    }

    const expiresAt = spotify?.tokenExpiresAt ? new Date(spotify.tokenExpiresAt).getTime() : 0;
    if (expiresAt > Date.now() + 60 * 1000) {
        return credentials.accessToken;
    }

    return refreshSpotifyAccessToken(user);
}

async function executeSpotifyApiRequest(accessToken, path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof URLSearchParams) && !(body instanceof Buffer)) {
        if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        body = JSON.stringify(body);
    }

    return fetch(`${SPOTIFY_API_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers,
        body,
    });
}

async function spotifyApiRequest(user, path, options = {}, retryOnUnauthorized = true) {
    const accessToken = await ensureSpotifyAccessToken(user);
    const response = await executeSpotifyApiRequest(accessToken, path, options);

    if (response.status === 401 && retryOnUnauthorized) {
        const nextToken = await refreshSpotifyAccessToken(user);
        const retryResponse = await executeSpotifyApiRequest(nextToken, path, options);
        return spotifyApiRequestResult(user, retryResponse);
    }

    return spotifyApiRequestResult(user, response);
}

async function spotifyApiRequestResult(user, response) {
    const payload = await parseSpotifyResponse(response);

    if (!response.ok) {
        const error = createSpotifyApiError(response, payload);
        if (error.code === 'REAUTH_REQUIRED') {
            await markSpotifyReauthRequired(user, error.message);
        }
        throw error;
    }

    return payload;
}

function buildSpotifyAuthorizeUrl(user, sessionId, req) {
    const { clientId, redirectUri } = assertSpotifyConfigured();
    const returnOrigin = resolveReturnOrigin(req);

    const state = signLinkedAccountState({
        provider: 'spotify',
        userId: String(user._id),
        sessionId,
        returnOrigin,
        nonce: crypto.randomUUID(),
    });

    const authorizeUrl = new URL(`${SPOTIFY_ACCOUNTS_BASE_URL}/authorize`);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('show_dialog', 'true');

    return authorizeUrl.toString();
}

async function completeSpotifyLink(user, code) {
    const tokenPayload = await requestSpotifyToken({
        grant_type: 'authorization_code',
        code,
    });

    const profile = await fetchSpotifyProfile(tokenPayload.access_token);
    persistSpotifyTokens(user, tokenPayload, profile, { touchConnectedAt: true });
    await user.save();
    return serializeSpotifyLinkedAccount(user.linkedAccounts?.spotify);
}

async function disconnectSpotifyAccount(user) {
    user.clearLinkedAccount('spotify');
    await user.save();
    return serializeSpotifyLinkedAccount(user.linkedAccounts?.spotify);
}

async function getSpotifyStatus(user) {
    assertSpotifyConfigured();
    return serializeSpotifyLinkedAccount(user?.linkedAccounts?.spotify);
}

async function getSpotifyPlaybackState(user) {
    return await spotifyApiRequest(user, '/me/player');
}

async function getSpotifyQueue(user) {
    const payload = await spotifyApiRequest(user, '/me/player/queue');
    return Array.isArray(payload?.queue) ? payload.queue : [];
}

async function pauseSpotify(user) {
    await spotifyApiRequest(user, '/me/player/pause', { method: 'PUT' });
}

async function playSpotify(user, body = undefined) {
    await spotifyApiRequest(user, '/me/player/play', {
        method: 'PUT',
        body: body && Object.keys(body).length > 0 ? body : undefined,
    });
}

async function nextSpotifyTrack(user) {
    await spotifyApiRequest(user, '/me/player/next', { method: 'POST' });
}

async function previousSpotifyTrack(user) {
    await spotifyApiRequest(user, '/me/player/previous', { method: 'POST' });
}

async function seekSpotify(user, positionMs) {
    await spotifyApiRequest(
        user,
        `/me/player/seek?position_ms=${encodeURIComponent(Math.max(0, Math.floor(positionMs)))}`,
        { method: 'PUT' }
    );
}

async function setSpotifyVolume(user, volumePercent) {
    const normalized = Math.max(0, Math.min(100, Math.floor(volumePercent)));
    await spotifyApiRequest(
        user,
        `/me/player/volume?volume_percent=${encodeURIComponent(normalized)}`,
        { method: 'PUT' }
    );
}

async function setSpotifyShuffle(user, enabled) {
    await spotifyApiRequest(
        user,
        `/me/player/shuffle?state=${enabled ? 'true' : 'false'}`,
        { method: 'PUT' }
    );
}

async function setSpotifyRepeat(user, state) {
    await spotifyApiRequest(
        user,
        `/me/player/repeat?state=${encodeURIComponent(state)}`,
        { method: 'PUT' }
    );
}

async function playSpotifyTrack(user, uri) {
    await playSpotify(user, { uris: [uri] });
}

module.exports = {
    SPOTIFY_SCOPES,
    buildSpotifyAuthorizeUrl,
    completeSpotifyLink,
    disconnectSpotifyAccount,
    getSpotifyPlaybackState,
    getSpotifyQueue,
    getSpotifyStatus,
    nextSpotifyTrack,
    pauseSpotify,
    playSpotify,
    playSpotifyTrack,
    previousSpotifyTrack,
    seekSpotify,
    setSpotifyRepeat,
    setSpotifyShuffle,
    setSpotifyVolume,
};
