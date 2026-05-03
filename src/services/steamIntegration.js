const crypto = require('crypto');

const {
    createLinkedAccountError,
    resolveReturnOrigin,
    signLinkedAccountState,
} = require('./linkedAccounts');

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_API_BASE_URL = 'https://api.steampowered.com';
const STEAM_STORE_FEATURED_CATEGORIES_URL = 'https://store.steampowered.com/api/featuredcategories';
const STEAM_SCOPES = ['openid', 'friends.read', 'presence.read'];
const STEAM_CACHE_TTL_MS = 60_000;
const STEAM_PERSONA_STATES = {
    0: 'offline',
    1: 'online',
    2: 'busy',
    3: 'away',
    4: 'snooze',
    5: 'looking_to_trade',
    6: 'looking_to_play',
};

const _steamCache = new Map();

function _getSteamCached(key) {
    const entry = _steamCache.get(key);
    if (!entry || Date.now() - entry.ts > STEAM_CACHE_TTL_MS) {
        _steamCache.delete(key);
        return undefined;
    }
    return entry.value;
}

function _setSteamCache(key, value) {
    _steamCache.set(key, { value, ts: Date.now() });
}

function assertSteamConfigured(options = {}) {
    const requireRedirectUri = options.requireRedirectUri !== false;
    const requireWebApiKey = options.requireWebApiKey !== false;
    const redirectUri = String(process.env.STEAM_REDIRECT_URI || '').trim();
    const apiKey = String(process.env.STEAM_WEB_API_KEY || '').trim();

    if (requireRedirectUri && !redirectUri) {
        throw createLinkedAccountError(
            500,
            'STEAM_NOT_CONFIGURED',
            'Steam is not configured in the backend.'
        );
    }

    if (requireWebApiKey && !apiKey) {
        throw createLinkedAccountError(
            500,
            'STEAM_NOT_CONFIGURED',
            'Steam Web API key is not configured in the backend.'
        );
    }

    return { apiKey, redirectUri };
}

function getMutableSteamAccount(user) {
    user.linkedAccounts = user.linkedAccounts || {};
    if (!user.linkedAccounts.steam) {
        user.linkedAccounts.steam = {
            status: 'disconnected',
            scopes: [],
        };
    }

    return user.linkedAccounts.steam;
}

function parseSteamStatus(account) {
    return {
        status: account?.status || 'disconnected',
        profile: account?.profile || null,
        connectedAt: account?.connectedAt || null,
        tokenExpiresAt: account?.tokenExpiresAt || null,
        scopes: Array.isArray(account?.scopes) ? account.scopes : [],
        lastError: account?.lastError || null,
    };
}

function normalizeSteamId(value) {
    const steamId = String(value || '').trim();
    return /^\d{15,20}$/.test(steamId) ? steamId : null;
}

function serializeSteamProfile(profile = {}) {
    const steamId = normalizeSteamId(profile.steamid || profile.steamId);
    const personaName = profile.personaname || profile.personaName || profile.displayName || null;

    return {
        steamId,
        personaName,
        displayName: personaName,
        avatarUrl: profile.avatarfull || profile.avatarmedium || profile.avatar || profile.avatarUrl || null,
        profileUrl: profile.profileurl || profile.profileUrl || null,
        visibilityState:
            profile.communityvisibilitystate !== undefined
                ? Number(profile.communityvisibilitystate)
                : profile.visibilityState ?? null,
    };
}

function buildSteamAuthorizeUrl(user, sessionId, req) {
    const { redirectUri } = assertSteamConfigured();
    const returnOrigin = resolveReturnOrigin(req);
    const state = signLinkedAccountState({
        provider: 'steam',
        userId: String(user._id),
        sessionId,
        returnOrigin,
        nonce: crypto.randomUUID(),
    });

    const returnTo = new URL(redirectUri);
    returnTo.searchParams.set('state', state);

    const authorizeUrl = new URL(STEAM_OPENID_URL);
    authorizeUrl.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
    authorizeUrl.searchParams.set('openid.mode', 'checkid_setup');
    authorizeUrl.searchParams.set('openid.return_to', returnTo.toString());
    authorizeUrl.searchParams.set('openid.realm', new URL(redirectUri).origin);
    authorizeUrl.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select');
    authorizeUrl.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select');

    return authorizeUrl.toString();
}

function extractSteamIdFromClaimedId(value) {
    const claimedId = String(value || '').trim();
    const match = claimedId.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{15,20})$/);
    if (!match) {
        throw createLinkedAccountError(
            400,
            'STEAM_OPENID_INVALID',
            'Steam did not return a valid account identifier.'
        );
    }

    return match[1];
}

function buildOpenIdVerificationBody(query) {
    const body = new URLSearchParams();

    for (const [key, value] of Object.entries(query || {})) {
        if (!key.startsWith('openid.')) continue;
        if (Array.isArray(value)) {
            for (const item of value) body.append(key, String(item));
            continue;
        }
        if (value !== undefined && value !== null) {
            body.set(key, String(value));
        }
    }

    body.set('openid.mode', 'check_authentication');
    return body;
}

async function verifySteamOpenId(query) {
    if (String(query?.['openid.mode'] || '') === 'cancel') {
        throw createLinkedAccountError(
            400,
            'STEAM_AUTH_DENIED',
            'Steam authorization was cancelled.'
        );
    }

    if (String(query?.['openid.mode'] || '') !== 'id_res') {
        throw createLinkedAccountError(
            400,
            'STEAM_OPENID_INVALID',
            'Steam did not return a valid OpenID response.'
        );
    }

    const steamId = extractSteamIdFromClaimedId(query?.['openid.claimed_id']);
    const response = await fetch(STEAM_OPENID_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/plain',
        },
        body: buildOpenIdVerificationBody(query),
    });
    const text = await response.text();

    if (!response.ok || !/(^|\n)is_valid:true(\n|$)/.test(text)) {
        throw createLinkedAccountError(
            400,
            'STEAM_OPENID_INVALID',
            'Steam could not verify the linked account response.'
        );
    }

    return steamId;
}

async function parseSteamResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 204) return null;

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

function getSteamErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) return payload.trim();
    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
    if (typeof payload?.response?.error === 'string' && payload.response.error.trim()) {
        return payload.response.error.trim();
    }
    return fallback;
}

function createSteamApiError(response, payload, fallback) {
    const message = getSteamErrorMessage(payload, fallback || `Steam returned error ${response.status}.`);

    if (response.status === 401 || response.status === 403) {
        return createLinkedAccountError(
            412,
            'STEAM_ACCESS_DENIED',
            message || 'Steam profile or friends data is private or unavailable.',
            payload
        );
    }

    if (response.status === 429) {
        return createLinkedAccountError(
            429,
            'STEAM_RATE_LIMITED',
            message,
            payload
        );
    }

    return createLinkedAccountError(
        502,
        'STEAM_API_ERROR',
        message,
        payload
    );
}

async function steamApiRequest(path, params = {}) {
    const { apiKey } = assertSteamConfigured({ requireRedirectUri: false });
    const url = new URL(path.startsWith('http') ? path : `${STEAM_API_BASE_URL}${path}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('format', 'json');

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && String(value).trim()) {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Prometeo/1.0 (+steam)',
        },
    });
    const payload = await parseSteamResponse(response);

    if (!response.ok) {
        throw createSteamApiError(response, payload);
    }

    return payload;
}

async function fetchSteamProfiles(steamIds) {
    const ids = Array.from(new Set(
        steamIds
            .map((id) => normalizeSteamId(id))
            .filter(Boolean)
    ));
    if (ids.length === 0) return [];

    const players = [];
    for (let index = 0; index < ids.length; index += 100) {
        const chunk = ids.slice(index, index + 100);
        const payload = await steamApiRequest('/ISteamUser/GetPlayerSummaries/v2/', {
            steamids: chunk.join(','),
        });
        const chunkPlayers = Array.isArray(payload?.response?.players)
            ? payload.response.players
            : [];
        players.push(...chunkPlayers);
    }

    return players;
}

async function completeSteamLink(user, query) {
    assertSteamConfigured();
    const steamId = await verifySteamOpenId(query);
    const [profile] = await fetchSteamProfiles([steamId]).catch(() => []);
    const steam = getMutableSteamAccount(user);

    steam.status = 'connected';
    steam.profile = serializeSteamProfile({ steamid: steamId, ...(profile || {}) });
    steam.scopes = STEAM_SCOPES;
    steam.connectedAt = new Date();
    steam.tokenExpiresAt = null;
    steam.lastError = null;
    steam.credentials = undefined;

    await user.save();
    return parseSteamStatus(user.linkedAccounts?.steam);
}

async function disconnectSteamAccount(user) {
    user.clearLinkedAccount('steam');
    await user.save();
    return parseSteamStatus(user.linkedAccounts?.steam);
}

async function getSteamStatus(user) {
    assertSteamConfigured();
    return parseSteamStatus(user?.linkedAccounts?.steam);
}

function assertSteamLinked(user) {
    const steam = user?.linkedAccounts?.steam;
    if (!steam || steam.status !== 'connected' || !steam.profile?.steamId) {
        throw createLinkedAccountError(
            412,
            'LINKED_ACCOUNT_REQUIRED',
            'Link your Steam account from Account to use this integration.'
        );
    }

    return steam;
}

function normalizePersonaState(value) {
    const state = Number(value);
    return Number.isFinite(state) ? state : 0;
}

function normalizeSteamFriend(player, friendSince = null) {
    const personaState = normalizePersonaState(player?.personastate);
    const appId = player?.gameid ? String(player.gameid) : null;
    const gameName = player?.gameextrainfo || null;

    return {
        steamId: String(player?.steamid || ''),
        personaName: player?.personaname || 'Steam friend',
        personaState,
        personaStateLabel: STEAM_PERSONA_STATES[personaState] || 'unknown',
        avatarUrl: player?.avatarfull || player?.avatarmedium || player?.avatar || null,
        profileUrl: player?.profileurl || null,
        friendSince,
        game: appId || gameName
            ? {
                appId,
                name: gameName || `Steam app ${appId}`,
            }
            : null,
    };
}

function sortSteamFriends(a, b) {
    const aPlaying = a.game ? 1 : 0;
    const bPlaying = b.game ? 1 : 0;
    if (aPlaying !== bPlaying) return bPlaying - aPlaying;

    const aOnline = a.personaState > 0 ? 1 : 0;
    const bOnline = b.personaState > 0 ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;

    return a.personaName.localeCompare(b.personaName);
}

async function getSteamFriendsPresence(user, options = {}) {
    const provider = parseSteamStatus(user?.linkedAccounts?.steam);
    const disconnectedMessage = provider.status === 'connected'
        ? null
        : 'Link your Steam account from Account to unlock Steam friends.';

    if (provider.status !== 'connected') {
        return {
            provider,
            profile: provider.profile || {},
            friends: [],
            onlineCount: 0,
            playingCount: 0,
            totalFriends: 0,
            inspectedCount: 0,
            error: disconnectedMessage,
        };
    }

    const steam = assertSteamLinked(user);
    const steamId = steam.profile.steamId;
    const limit = Math.max(1, Math.min(24, Number(options.limit) || 8));
    const maxFriendsToInspect = Math.max(10, Math.min(500, Number(options.maxFriendsToInspect) || 200));
    const cacheKey = `friends:${steamId}:${limit}:${maxFriendsToInspect}`;
    const cached = _getSteamCached(cacheKey);
    if (cached) return cached;

    const friendsPayload = await steamApiRequest('/ISteamUser/GetFriendList/v1/', {
        steamid: steamId,
        relationship: 'friend',
    });
    const rawFriends = Array.isArray(friendsPayload?.friendslist?.friends)
        ? friendsPayload.friendslist.friends
        : [];
    const inspectableFriends = rawFriends.slice(0, maxFriendsToInspect);
    const friendSinceById = new Map(
        inspectableFriends.map((friend) => [
            String(friend.steamid || ''),
            friend.friend_since ? new Date(Number(friend.friend_since) * 1000).toISOString() : null,
        ])
    );
    const players = await fetchSteamProfiles(inspectableFriends.map((friend) => friend.steamid));
    const friends = players
        .map((player) => normalizeSteamFriend(player, friendSinceById.get(String(player.steamid || '')) || null))
        .sort(sortSteamFriends);
    const onlineCount = friends.filter((friend) => friend.personaState > 0).length;
    const playingCount = friends.filter((friend) => Boolean(friend.game)).length;

    const result = {
        provider,
        profile: steam.profile || {},
        friends: friends.slice(0, limit),
        onlineCount,
        playingCount,
        totalFriends: rawFriends.length,
        inspectedCount: inspectableFriends.length,
    };

    _setSteamCache(cacheKey, result);
    return result;
}

function normalizeCountry(value) {
    const country = String(value || process.env.STEAM_STORE_COUNTRY || 'ES')
        .trim()
        .toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : 'ES';
}

function normalizeLanguage(value) {
    const language = String(value || process.env.STEAM_STORE_LANGUAGE || 'spanish')
        .trim()
        .toLowerCase();
    return /^[a-z_ -]{2,32}$/.test(language) ? language : 'spanish';
}

function normalizeSteamDeal(item) {
    const appId = Number(item?.id || item?.appid);
    if (!Number.isFinite(appId)) return null;

    return {
        appId,
        name: item?.name || `Steam app ${appId}`,
        discountPercent: Math.max(0, Number(item?.discount_percent) || 0),
        originalPrice: Number.isFinite(Number(item?.original_price)) ? Number(item.original_price) : null,
        finalPrice: Number.isFinite(Number(item?.final_price)) ? Number(item.final_price) : null,
        currency: item?.currency || null,
        image: item?.header_image || item?.small_capsule_image || null,
        largeImage: item?.large_capsule_image || item?.header_image || null,
        url: `https://store.steampowered.com/app/${appId}`,
        discountExpiration: item?.discount_expiration
            ? new Date(Number(item.discount_expiration) * 1000).toISOString()
            : null,
        platforms: {
            windows: Boolean(item?.windows_available),
            mac: Boolean(item?.mac_available),
            linux: Boolean(item?.linux_available),
        },
    };
}

async function getSteamDeals(options = {}) {
    const country = normalizeCountry(options.country);
    const language = normalizeLanguage(options.language);
    const limit = Math.max(1, Math.min(24, Number(options.limit) || 8));
    const cacheKey = `deals:${country}:${language}:${limit}`;
    const cached = _getSteamCached(cacheKey);
    if (cached) return cached;

    const url = new URL(STEAM_STORE_FEATURED_CATEGORIES_URL);
    url.searchParams.set('cc', country);
    url.searchParams.set('l', language);

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Prometeo/1.0 (+steam-store)',
        },
    });
    const payload = await parseSteamResponse(response);

    if (!response.ok) {
        throw createSteamApiError(response, payload, `Steam Store returned error ${response.status}.`);
    }

    const rawItems = Array.isArray(payload?.specials?.items) ? payload.specials.items : [];
    const deals = rawItems
        .map(normalizeSteamDeal)
        .filter(Boolean)
        .filter((deal) => deal.discountPercent > 0)
        .slice(0, limit);
    const result = {
        country,
        language,
        generatedAt: new Date().toISOString(),
        deals,
    };

    _setSteamCache(cacheKey, result);
    return result;
}

module.exports = {
    STEAM_SCOPES,
    buildSteamAuthorizeUrl,
    completeSteamLink,
    disconnectSteamAccount,
    getSteamDeals,
    getSteamFriendsPresence,
    getSteamStatus,
    verifySteamOpenId,
};
