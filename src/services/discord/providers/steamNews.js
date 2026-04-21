const STEAM_NEWS_ENDPOINT = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/';
const ALWAYS_INCLUDE_FEEDS = new Set(['steam_updates']);
const TITLE_GATED_FEEDS = new Set(['steam_community_announcements']);
const UPDATE_TITLE_PATTERN = /\b(update|patch|hotfix|release notes?)\b/i;

function normalize(raw) {
    const dateSeconds = Number(raw?.date);
    return {
        gid: String(raw?.gid ?? ''),
        title: String(raw?.title ?? ''),
        url: String(raw?.url ?? ''),
        contents: typeof raw?.contents === 'string' ? raw.contents : '',
        date: Number.isFinite(dateSeconds) ? new Date(dateSeconds * 1000) : null,
        feedname: String(raw?.feedname ?? ''),
    };
}

function isPatchItem(item) {
    if (!item.gid) return false;
    if (ALWAYS_INCLUDE_FEEDS.has(item.feedname)) return true;
    if (TITLE_GATED_FEEDS.has(item.feedname)) {
        return UPDATE_TITLE_PATTERN.test(item.title);
    }
    return false;
}

function createSteamNewsProvider({ fetch: fetchFn = null, logger = console } = {}) {
    return {
        async fetchLatestUpdates(appId, { limit = 5 } = {}) {
            const client = fetchFn || global.fetch;
            if (typeof client !== 'function') {
                throw new Error('fetch is not available in this Node runtime');
            }

            const params = new URLSearchParams({
                appid: String(appId),
                count: String(limit),
            });
            const url = `${STEAM_NEWS_ENDPOINT}?${params.toString()}`;

            const response = await client(url, {
                headers: { 'User-Agent': 'Prometeo/1.0 (+steam-news)' },
            });

            if (!response.ok) {
                throw new Error(`Steam News API returned ${response.status}`);
            }

            const payload = await response.json();
            const items = payload?.appnews?.newsitems;
            if (!Array.isArray(items)) return [];

            return items.map(normalize).filter(isPatchItem);
        },
    };
}

module.exports = {
    createSteamNewsProvider,
    STEAM_NEWS_ENDPOINT,
    ALWAYS_INCLUDE_FEEDS,
    TITLE_GATED_FEEDS,
    UPDATE_TITLE_PATTERN,
};
