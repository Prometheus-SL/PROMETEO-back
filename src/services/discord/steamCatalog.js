const STEAM_STORESEARCH_ENDPOINT = 'https://store.steampowered.com/api/storesearch/';
const STEAM_APPDETAILS_ENDPOINT = 'https://store.steampowered.com/api/appdetails';
const HARD_RESULT_CAP = 20;

const EXCLUDE_PATTERN = /\b(soundtrack|ost|dlc|demo|beta|trailer|dedicated server|playtest|pre[- ]?order|deluxe upgrade|season pass|test)\b/i;

function createSteamCatalog({
    fetch: fetchFn = null,
    logger = console,
    cc = 'us',
    l = 'en',
} = {}) {
    const nameCache = new Map();

    function getFetch() {
        const client = fetchFn || global.fetch;
        if (typeof client !== 'function') return null;
        return client;
    }

    async function search(query, { limit = HARD_RESULT_CAP } = {}) {
        const trimmed = typeof query === 'string' ? query.trim() : '';
        if (trimmed.length < 2) return [];

        const client = getFetch();
        if (!client) {
            logger.warn('[SteamCatalog] fetch not available');
            return [];
        }

        const cap = Math.min(limit, HARD_RESULT_CAP);
        const url = `${STEAM_STORESEARCH_ENDPOINT}?term=${encodeURIComponent(trimmed)}&cc=${encodeURIComponent(cc)}&l=${encodeURIComponent(l)}`;
        try {
            const response = await client(url, {
                headers: { 'User-Agent': 'Prometeo/1.0 (+steam-search)' },
            });
            if (!response.ok) {
                logger.warn(`[SteamCatalog] storesearch returned ${response.status}`);
                return [];
            }
            const payload = await response.json();
            const items = Array.isArray(payload?.items) ? payload.items : [];
            const out = [];
            for (const item of items) {
                const appId = Number(item?.id);
                const name = typeof item?.name === 'string' ? item.name : null;
                if (!Number.isFinite(appId) || !name) continue;
                if (EXCLUDE_PATTERN.test(name)) continue;
                if (item?.type && item.type !== 'app') continue;
                nameCache.set(appId, name);
                out.push({ appId, name });
                if (out.length >= cap) break;
            }
            return out;
        } catch (err) {
            logger.warn(`[SteamCatalog] search failed: ${err.message}`);
            return [];
        }
    }

    async function getName(appId) {
        if (!Number.isFinite(appId)) return null;
        if (nameCache.has(appId)) return nameCache.get(appId);

        const client = getFetch();
        if (!client) return null;

        const url = `${STEAM_APPDETAILS_ENDPOINT}?appids=${encodeURIComponent(appId)}&l=${encodeURIComponent(l)}&filters=basic`;
        try {
            const response = await client(url, {
                headers: { 'User-Agent': 'Prometeo/1.0 (+steam-appdetails)' },
            });
            if (!response.ok) return null;
            const payload = await response.json();
            const entry = payload?.[String(appId)];
            if (!entry?.success || !entry?.data?.name) return null;
            const name = String(entry.data.name);
            nameCache.set(appId, name);
            return name;
        } catch (err) {
            logger.warn(`[SteamCatalog] appdetails failed for ${appId}: ${err.message}`);
            return null;
        }
    }

    function start() { /* no-op: on-demand HTTP, no scheduled refresh */ }
    function stop() { /* no-op */ }
    async function refresh() { /* no-op, kept for compat */ }

    return { refresh, search, getName, start, stop };
}

let sharedCatalog = null;

function getSharedCatalog() {
    if (!sharedCatalog) {
        sharedCatalog = createSteamCatalog();
    }
    return sharedCatalog;
}

module.exports = {
    createSteamCatalog,
    getSharedCatalog,
    STEAM_STORESEARCH_ENDPOINT,
    STEAM_APPDETAILS_ENDPOINT,
    EXCLUDE_PATTERN,
};
