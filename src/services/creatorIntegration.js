function readCreatorConfig() {
    return {
        youtubeChannelId: String(process.env.CREATOR_YOUTUBE_CHANNEL_ID || '').trim(),
        youtubeApiKey: String(process.env.CREATOR_YOUTUBE_API_KEY || '').trim(),
        twitchUserLogin: String(process.env.CREATOR_TWITCH_USER_LOGIN || '').trim(),
        twitchClientId: String(process.env.TWITCH_CLIENT_ID || '').trim(),
        twitchAppAccessToken: String(process.env.TWITCH_APP_ACCESS_TOKEN || '').trim(),
    };
}

const _creatorCache = new Map();
const CREATOR_CACHE_TTL_MS = 60_000;

function _getCreatorCached(key) {
    const entry = _creatorCache.get(key);
    if (!entry || Date.now() - entry.ts > CREATOR_CACHE_TTL_MS) {
        _creatorCache.delete(key);
        return undefined;
    }
    return entry.value;
}

function _setCreatorCache(key, value) {
    _creatorCache.set(key, { value, ts: Date.now() });
}

async function parseResponse(response) {
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

async function getYoutubeSourceStatus(config) {
    if (!config.youtubeChannelId || !config.youtubeApiKey) {
        return {
            id: 'youtube',
            label: 'YouTube',
            status: 'unavailable',
            headline: 'Configure CREATOR_YOUTUBE_CHANNEL_ID and CREATOR_YOUTUBE_API_KEY.',
            url: null,
            startedAt: null,
        };
    }

    const liveUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    liveUrl.searchParams.set('part', 'snippet');
    liveUrl.searchParams.set('channelId', config.youtubeChannelId);
    liveUrl.searchParams.set('eventType', 'live');
    liveUrl.searchParams.set('type', 'video');
    liveUrl.searchParams.set('maxResults', '1');
    liveUrl.searchParams.set('key', config.youtubeApiKey);

    const response = await fetch(liveUrl.toString());
    const payload = await parseResponse(response);
    const liveItem = Array.isArray(payload?.items) ? payload.items[0] : null;

    if (liveItem?.id?.videoId) {
        return {
            id: 'youtube',
            label: 'YouTube',
            status: 'live',
            headline: liveItem?.snippet?.title || 'Live on YouTube',
            url: `https://www.youtube.com/watch?v=${liveItem.id.videoId}`,
            startedAt: liveItem?.snippet?.publishedAt || null,
        };
    }

    return {
        id: 'youtube',
        label: 'YouTube',
        status: 'offline',
        headline: 'No live YouTube stream detected right now.',
        url: `https://www.youtube.com/channel/${config.youtubeChannelId}`,
        startedAt: null,
    };
}

async function fetchTwitchUser(config) {
    const usersUrl = new URL('https://api.twitch.tv/helix/users');
    usersUrl.searchParams.set('login', config.twitchUserLogin);

    const response = await fetch(usersUrl.toString(), {
        headers: {
            'Client-Id': config.twitchClientId,
            Authorization: `Bearer ${config.twitchAppAccessToken}`,
        },
    });
    const payload = await parseResponse(response);
    return Array.isArray(payload?.data) ? payload.data[0] : null;
}

async function getTwitchSourceStatus(config) {
    if (!config.twitchUserLogin || !config.twitchClientId || !config.twitchAppAccessToken) {
        return {
            id: 'twitch',
            label: 'Twitch',
            status: 'unavailable',
            headline: 'Configure CREATOR_TWITCH_USER_LOGIN, TWITCH_CLIENT_ID and TWITCH_APP_ACCESS_TOKEN.',
            url: null,
            startedAt: null,
        };
    }

    const streamsUrl = new URL('https://api.twitch.tv/helix/streams');
    streamsUrl.searchParams.set('user_login', config.twitchUserLogin);

    const response = await fetch(streamsUrl.toString(), {
        headers: {
            'Client-Id': config.twitchClientId,
            Authorization: `Bearer ${config.twitchAppAccessToken}`,
        },
    });
    const payload = await parseResponse(response);
    const stream = Array.isArray(payload?.data) ? payload.data[0] : null;

    if (stream) {
        return {
            id: 'twitch',
            label: 'Twitch',
            status: 'live',
            headline: stream.title || `Live on Twitch for ${config.twitchUserLogin}`,
            url: `https://www.twitch.tv/${config.twitchUserLogin}`,
            startedAt: stream.started_at || null,
        };
    }

    const user = await fetchTwitchUser(config).catch(() => null);
    return {
        id: 'twitch',
        label: 'Twitch',
        status: 'offline',
        headline: user?.display_name
            ? `${user.display_name} is offline right now.`
            : 'No live Twitch stream detected right now.',
        url: `https://www.twitch.tv/${config.twitchUserLogin}`,
        startedAt: null,
    };
}

async function getCreatorDashboardStatus() {
    const cached = _getCreatorCached('dashboard');
    if (cached) return cached;

    const config = readCreatorConfig();
    const sources = await Promise.all([
        getYoutubeSourceStatus(config).catch((error) => ({
            id: 'youtube',
            label: 'YouTube',
            status: 'unavailable',
            headline: error?.message || 'YouTube status unavailable.',
            url: null,
            startedAt: null,
        })),
        getTwitchSourceStatus(config).catch((error) => ({
            id: 'twitch',
            label: 'Twitch',
            status: 'unavailable',
            headline: error?.message || 'Twitch status unavailable.',
            url: null,
            startedAt: null,
        })),
    ]);

    const liveCount = sources.filter((source) => source.status === 'live').length;

    const result = {
        online: liveCount > 0,
        liveCount,
        sources,
    };
    _setCreatorCache('dashboard', result);
    return result;
}

async function getCreatorStatus() {
    const cached = _getCreatorCached('status');
    if (cached) return cached;

    const dashboardStatus = await getCreatorDashboardStatus();
    const configuredSources = dashboardStatus.sources.filter((source) => source.status !== 'unavailable');
    const status = configuredSources.length > 0 ? 'connected' : 'disconnected';

    const result = {
        status,
        profile: {
            displayName: 'Creator Sources',
            liveCount: dashboardStatus.liveCount,
        },
        connectedAt: null,
        tokenExpiresAt: null,
        scopes: [],
        lastError: configuredSources.length > 0
            ? null
            : 'Configure at least one creator source to unlock live status widgets.',
    };
    _setCreatorCache('status', result);
    return result;
}

module.exports = {
    getCreatorDashboardStatus,
    getCreatorStatus,
};
