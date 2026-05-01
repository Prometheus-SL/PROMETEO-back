// SofaScore live-score scraper. Used as a fallback when the FotMob scraper
// can't supply a parseable game minute for an in-progress match — SofaScore's
// public `events/live` endpoint exposes `time.currentPeriodStartTimestamp`,
// which lets us compute the EXACT current minute (including stoppage and
// halftime offset) instead of inventing one from kickoff.

const SOFA_BASE = 'https://api.sofascore.com/api/v1';
const SOFA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.sofascore.com/',
    'Origin': 'https://www.sofascore.com',
};

const TTL_LIVE_SCORE = 5 * 1000; // matches the FotMob scraper's TTL

const NOISE_TOKENS = new Set([
    'fc', 'cf', 'club', 'de', 'la', 'real', 'cd', 'sd', 'ud', 'rcd', 'sc',
]);

function stripDiacritics(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokenize(name) {
    return stripDiacritics(name)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t && !NOISE_TOKENS.has(t));
}

function teamNamesMatch(candidate, target) {
    const a = tokenize(candidate);
    const b = tokenize(target);
    if (a.length === 0 || b.length === 0) return false;
    const setA = new Set(a);
    const setB = new Set(b);
    return a.every((t) => setB.has(t)) || b.every((t) => setA.has(t));
}

function createSofaScoreScraper({
    fetch = globalThis.fetch,
    now = () => Date.now(),
    cache,
} = {}) {
    const localCache = cache ?? require('./footballCache').createCache({ now });

    async function fetchLiveEvents() {
        const url = `${SOFA_BASE}/sport/football/events/live`;
        let response;
        try {
            response = await fetch(url, { headers: SOFA_HEADERS });
        } catch (err) {
            console.warn(`[sofaScoreScraper] network error: ${err.message}`);
            return null;
        }
        if (!response.ok) {
            console.warn(`[sofaScoreScraper] status ${response.status}`);
            return null;
        }
        try {
            return await response.json();
        } catch (err) {
            console.warn(`[sofaScoreScraper] parse error: ${err.message}`);
            return null;
        }
    }

    // Convert SofaScore's `time.currentPeriodStartTimestamp` + status description
    // into a FotMob-style "37'" / "45+2'" / "HT" string. The minute is computed
    // from the period start so it stays accurate across halftime / extra time.
    function computeStatusText(event) {
        const desc = String(event?.status?.description || '').toLowerCase();
        const code = Number(event?.status?.code);
        const periodStartSec = Number(event?.time?.currentPeriodStartTimestamp);

        if (desc.includes('halftime') || desc.includes('half time') || code === 31) {
            return 'HT';
        }
        // Match has finished — return a recognisable token so upstream can flip
        // the snapshot's state out of 'live' even when football-data.org's free
        // tier still lags on IN_PLAY.
        if (desc.includes('full') || desc.includes('ended') || code === 100) {
            if (desc.includes('penalt')) return 'Pen';
            if (desc.includes('extra') || desc.includes('aet')) return 'AET';
            return 'FT';
        }
        if (!Number.isFinite(periodStartSec) || periodStartSec <= 0) {
            return '';
        }

        const elapsedSec = Math.max(0, Math.floor(now() / 1000) - periodStartSec);
        const elapsedMin = Math.floor(elapsedSec / 60) + 1; // FotMob convention: 1-indexed

        // Map description → period base minute. SofaScore's typical descriptions:
        // "1st half", "2nd half", "Extra time", "Penalties", etc.
        if (desc.includes('1st') || desc.includes('first') || code === 6) {
            // Regular minute, capped at 45; anything beyond is shown as "45+N"
            if (elapsedMin > 45) return `45+${elapsedMin - 45}'`;
            return `${elapsedMin}'`;
        }
        if (desc.includes('2nd') || desc.includes('second') || code === 7) {
            const total = 45 + elapsedMin;
            if (total > 90) return `90+${total - 90}'`;
            return `${total}'`;
        }
        if (desc.includes('extra') || desc.includes('et') || desc.includes('overtime')) {
            return `${90 + elapsedMin}'`;
        }
        if (desc.includes('penalt')) {
            return 'Pen';
        }
        // Unknown description — fall back to nothing rather than guessing.
        return '';
    }

    async function findLiveScoreByTeams({ homeTeamName, awayTeamName }) {
        const cacheKey = `sofa:live:${stripDiacritics(homeTeamName).toLowerCase()}|${stripDiacritics(awayTeamName).toLowerCase()}`;
        return localCache.fetch(cacheKey, TTL_LIVE_SCORE, async () => {
            const payload = await fetchLiveEvents();
            if (!payload) return null;
            const events = Array.isArray(payload.events) ? payload.events : [];
            for (const event of events) {
                if (
                    teamNamesMatch(event.homeTeam?.name, homeTeamName) &&
                    teamNamesMatch(event.awayTeam?.name, awayTeamName)
                ) {
                    const homeScoreNum = Number(event.homeScore?.current);
                    const awayScoreNum = Number(event.awayScore?.current);
                    return {
                        homeScore: Number.isFinite(homeScoreNum) ? homeScoreNum : null,
                        awayScore: Number.isFinite(awayScoreNum) ? awayScoreNum : null,
                        statusText: computeStatusText(event),
                    };
                }
            }
            return null;
        });
    }

    return {
        findLiveScoreByTeams,
        _internal: { tokenize, teamNamesMatch, computeStatusText },
    };
}

module.exports = { createSofaScoreScraper };
