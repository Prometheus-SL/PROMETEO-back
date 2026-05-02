const FOTMOB_BASE = 'https://www.fotmob.com/api';
const FOTMOB_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.fotmob.com/',
    'Origin': 'https://www.fotmob.com',
};

// Short TTL so live scores feel near real-time. The frontend polls every 10s
// during in-progress matches; a 5s cache means we always serve a fresh-enough
// FotMob payload (at most 1 upstream request per ~5s per match), and goals
// show up in the widget within ~10–15s of happening.
const TTL_LIVE_SCORE = 5 * 1000;

const NOISE_TOKENS = new Set([
    'fc', 'cf', 'club', 'de', 'la', 'real', 'cd', 'sd', 'ud', 'rcd', 'sc',
    // (NOTE: 'real' is intentionally listed as a noise token only for FUZZY
    //  comparison, never for searching — Real Madrid vs Real Sociedad will
    //  still disambiguate via the OTHER team in the pair. See matchesTeamPair.)
]);

// Strip combining diacritical marks (U+0300..U+036F) after NFD decomposition.
// Using \u escapes here so the regex source is unambiguous regardless of
// the editor/encoding used to save this file.
function stripDiacritics(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokenize(name) {
    return stripDiacritics(name)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t && !NOISE_TOKENS.has(t));
}

function normalizeTeamKey(name) {
    return tokenize(name).sort().join(' ');
}

function teamNamesMatch(candidate, target) {
    const a = tokenize(candidate);
    const b = tokenize(target);
    if (a.length === 0 || b.length === 0) return false;
    // Pair matches if EITHER is a subset of the other (handles "Atletico"
    // vs "Atletico Madrid" or "Real Madrid" vs "Real Madrid CF" etc).
    const setA = new Set(a);
    const setB = new Set(b);
    const aInB = a.every((t) => setB.has(t));
    const bInA = b.every((t) => setA.has(t));
    return aInB || bInA;
}

function dateKeyFromMs(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

function createLiveScoreScraper({
    fetch = globalThis.fetch,
    now = () => Date.now(),
    cache,
} = {}) {
    const localCache = cache ?? require('./footballCache').createCache({ now });

    async function fetchMatchesForDate(dateKey) {
        // FotMob moved this endpoint from /api/matches to /api/data/matches and
        // now requires a `timezone` query param (without it, the new path 502s).
        // The legacy path returns a 404 HTML page, which silently broke live
        // score enrichment — the snapshot kept serving the football-data.org
        // free-tier score, which lags real time by minutes during a match.
        const url = `${FOTMOB_BASE}/data/matches?date=${dateKey}&timezone=UTC`;
        let response;
        try {
            response = await fetch(url, { headers: FOTMOB_HEADERS });
        } catch (err) {
            console.warn(`[liveScoreScraper] FotMob network error: ${err.message}`);
            return null;
        }
        if (!response.ok) {
            console.warn(`[liveScoreScraper] FotMob status ${response.status} for ${dateKey}`);
            return null;
        }
        try {
            return await response.json();
        } catch (err) {
            console.warn(`[liveScoreScraper] FotMob parse error: ${err.message}`);
            return null;
        }
    }

    async function findLiveScoreByTeams({ homeTeamName, awayTeamName, dateUtcMs }) {
        const dateKey = dateKeyFromMs(dateUtcMs);
        const cacheKey = `fotmob:${dateKey}:${normalizeTeamKey(homeTeamName)}|${normalizeTeamKey(awayTeamName)}`;

        return localCache.fetch(cacheKey, TTL_LIVE_SCORE, async () => {
            const payload = await fetchMatchesForDate(dateKey);
            if (!payload) return null;

            const leagues = Array.isArray(payload.leagues) ? payload.leagues : [];
            for (const league of leagues) {
                const matches = Array.isArray(league.matches) ? league.matches : [];
                for (const m of matches) {
                    if (
                        teamNamesMatch(m.home?.name, homeTeamName) &&
                        teamNamesMatch(m.away?.name, awayTeamName)
                    ) {
                        const homeScoreNum = Number(m.home?.score);
                        const awayScoreNum = Number(m.away?.score);
                        const homeScore = Number.isFinite(homeScoreNum) ? homeScoreNum : null;
                        const awayScore = Number.isFinite(awayScoreNum) ? awayScoreNum : null;
                        const statusText = String(m.status?.liveTime?.short || '').trim()
                            || (m.status?.ongoing ? 'LIVE' : '')
                            || '';
                        return { homeScore, awayScore, statusText };
                    }
                }
            }
            return null;
        });
    }

    return { findLiveScoreByTeams, _internal: { tokenize, teamNamesMatch, dateKeyFromMs } };
}

module.exports = { createLiveScoreScraper };
