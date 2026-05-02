const { createHttpError } = require('../http/errors');
const { createCache } = require('./footballCache');
const { getLeague } = require('./footballLeagues');

const FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';

// TTLs aligned with the 10 req/min free tier of football-data.org.
// MATCHES_WINDOW (30s) is the football-data.org cache. Live scores DON'T rely
// on this — `tryEnrichLiveMatch` re-queries the FotMob scraper on every
// snapshot request, and that scraper has its own much shorter cache (~5s).
// So MATCHES_WINDOW only governs how stale the FIXTURE list (kickoff times,
// matchday, etc.) can get, which is fine at 30s. Keeping this at 30s is what
// lets us stay under the 10 req/min free-tier limit with several leagues.
const TTL = Object.freeze({
    STANDINGS: 5 * 60 * 1000,        // 5 min
    MATCHES_WINDOW: 30 * 1000,       // 30s — match the frontend's live polling.
    LEAGUES: 24 * 60 * 60 * 1000,    // 24h — static metadata.
    LEAGUE_TEAMS: 24 * 60 * 60 * 1000, // 24h — team list rarely changes.
});

// Normalize text for fuzzy matching: trim, lowercase, strip diacritics.
// "Atléti" / "Atletí" / "atleti" all collapse to "atleti", and the official
// "Club Atlético de Madrid" becomes "club atletico de madrid" — so a substring
// search for "atleti" now matches the team without needing exact casing or
// accents.
function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
}

// Curated nicknames → canonical team-name fragments, normalized via the same
// rules. If a query exactly matches a key here, we expand it to the value
// before doing the substring search. Keep this list focused on the popular
// teams Spanish-speaking users actually type into the widget; we add more as
// users report misses. The substring engine on top of `normalizeText` already
// handles most accents/casing without needing entries here.
const TEAM_NICKNAMES = Object.freeze({
    // LaLiga
    'atleti': 'atletico de madrid',
    'colchoneros': 'atletico de madrid',
    'rojiblancos': 'atletico de madrid',
    'merengues': 'real madrid',
    'blancos': 'real madrid',
    'madridistas': 'real madrid',
    'culer': 'barcelona',
    'culers': 'barcelona',
    'culés': 'barcelona',
    'cules': 'barcelona',
    'barca': 'barcelona',
    'verdiblancos': 'real betis',
    'beticos': 'real betis',
    'rojillos': 'osasuna',
    'leones': 'athletic',
    'txuriurdin': 'real sociedad',
    'che': 'valencia',
    // Champions / international shortcuts
    'bayern': 'bayern munchen',
    'psg': 'paris',
    'united': 'manchester united',
    'city': 'manchester city',
    'inter': 'inter',
    'milan': 'milan',
});

function expandNickname(query) {
    const normalized = normalizeText(query);
    return TEAM_NICKNAMES[normalized] ?? normalized;
}

function buildYouTubeQuery(home, away, matchday, leagueLabel) {
    const safe = (s) => String(s || '').trim();
    const parts = [
        safe(home),
        'vs',
        safe(away),
        safe(leagueLabel),
        'highlights',
    ];
    if (matchday) parts.push(`jornada ${matchday}`);
    return parts.filter(Boolean).join(' ');
}

function buildUrl(pathname, query = {}) {
    const url = new URL(`${FOOTBALL_DATA_BASE_URL}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

function assertFootballDataConfigured() {
    const apiKey = String(process.env.FOOTBALL_DATA_API_KEY || '').trim();
    if (!apiKey) {
        throw createHttpError(
            500,
            'FOOTBALL_NOT_CONFIGURED',
            'Football integration is not configured in the backend (missing FOOTBALL_DATA_API_KEY).',
        );
    }
    return apiKey;
}

function mapStatus(rawStatus) {
    switch (rawStatus) {
        case 'IN_PLAY':
        case 'PAUSED':
        case 'EXTRA_TIME':
        case 'PENALTY':
            return 'inprogress';
        case 'FINISHED':
        case 'AWARDED':
            return 'finished';
        case 'SCHEDULED':
        case 'TIMED':
            return 'notstarted';
        case 'POSTPONED':
        case 'SUSPENDED':
        case 'CANCELLED':
            return 'cancelled';
        default:
            return String(rawStatus || '').toLowerCase();
    }
}

function humanStatus(rawStatus) {
    switch (rawStatus) {
        case 'IN_PLAY': return 'In progress';
        case 'PAUSED': return 'Half-time';
        case 'EXTRA_TIME': return 'Extra time';
        case 'PENALTY': return 'Penalty shootout';
        case 'FINISHED': return 'Ended';
        case 'AWARDED': return 'Awarded';
        case 'SCHEDULED':
        case 'TIMED': return 'Not started';
        case 'POSTPONED': return 'Postponed';
        case 'SUSPENDED': return 'Suspended';
        case 'CANCELLED': return 'Cancelled';
        default: return String(rawStatus || '');
    }
}

// `form` arrives from football-data.org as either "W,W,D,L,W" or "WWDLW"
// (different responses use different separators). Normalize to an ordered
// array of 'W'|'D'|'L' (oldest -> newest), capped at the last 5 entries.
function parseForm(raw) {
    if (typeof raw !== 'string' || !raw) return [];
    const tokens = raw.includes(',') ? raw.split(',') : raw.split('');
    return tokens
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t === 'W' || t === 'D' || t === 'L')
        .slice(-5);
}

function createFootballService({
    fetch = globalThis.fetch,
    now = () => Date.now(),
    liveScoreScraper,
    sofaScoreScraper,
} = {}) {
    const cache = createCache({ now });
    const scraper = liveScoreScraper
        ?? require('./liveScoreScraper').createLiveScoreScraper({ fetch, now, cache });
    const sofa = sofaScoreScraper
        ?? require('./sofaScoreScraper').createSofaScoreScraper({ fetch, now, cache });

    async function safeReadJson(response) {
        try { return await response.json(); } catch { return null; }
    }

    async function callFootballData(pathname, query) {
        const apiKey = assertFootballDataConfigured();
        const url = buildUrl(pathname, query);
        let response;
        try {
            response = await fetch(url, {
                headers: {
                    'X-Auth-Token': apiKey,
                    Accept: 'application/json',
                },
            });
        } catch (error) {
            throw createHttpError(
                502,
                'FOOTBALL_PROVIDER_ERROR',
                `Could not reach the football provider: ${error.message}`,
            );
        }

        if (!response.ok) {
            const detail = await safeReadJson(response);
            throw createHttpError(
                response.status >= 500 ? 502 : response.status,
                'FOOTBALL_PROVIDER_ERROR',
                `Football provider returned status ${response.status}.`,
                { details: detail },
            );
        }

        return response.json();
    }

    function normalizeTeam(team) {
        return {
            id: Number(team?.id) || 0,
            name: String(team?.name || ''),
            shortName: String(team?.shortName || team?.name || ''),
            code: String(team?.tla || ''),
            crest: String(team?.crest || ''),
        };
    }

    function normalizeStandingsRow(row) {
        return {
            position: Number(row?.position) || 0,
            team: normalizeTeam(row?.team),
            matches: Number(row?.playedGames) || 0,
            wins: Number(row?.won) || 0,
            draws: Number(row?.draw) || 0,
            losses: Number(row?.lost) || 0,
            goalsFor: Number(row?.goalsFor) || 0,
            goalsAgainst: Number(row?.goalsAgainst) || 0,
            goalDiff: Number(row?.goalDifference) || 0,
            points: Number(row?.points) || 0,
            form: parseForm(row?.form),
        };
    }

    function normalizeMatch(event) {
        if (!event) return null;
        const fullTime = event.score?.fullTime ?? {};
        const rawHome = fullTime.home;
        const rawAway = fullTime.away;
        const homeScore = rawHome == null ? null : Number(rawHome);
        const awayScore = rawAway == null ? null : Number(rawAway);
        const startTimestamp = event.utcDate
            ? Math.floor(new Date(event.utcDate).getTime() / 1000)
            : 0;
        return {
            id: Number(event.id) || 0,
            tournamentId: Number(event.competition?.id) || 0,
            round: Number(event.matchday) || null,
            startTimestamp,
            status: mapStatus(event.status),
            statusDescription: humanStatus(event.status),
            home: {
                team: normalizeTeam(event.homeTeam),
                score: homeScore != null && Number.isFinite(homeScore) ? homeScore : null,
            },
            away: {
                team: normalizeTeam(event.awayTeam),
                score: awayScore != null && Number.isFinite(awayScore) ? awayScore : null,
            },
        };
    }

    async function findMatchHighlight(match, leagueLabel) {
        if (!match || !match.id) return null;
        const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
        if (!apiKey) return null;

        const TTL_HIGHLIGHTS = 6 * 60 * 60 * 1000; // 6h
        const key = `youtube-highlight:${match.id}`;

        return cache.fetch(key, TTL_HIGHLIGHTS, async () => {
            const q = buildYouTubeQuery(
                match.home?.team?.name,
                match.away?.team?.name,
                match.round,
                leagueLabel,
            );
            const url = new URL(`${YOUTUBE_API_BASE_URL}/search`);
            url.searchParams.set('part', 'snippet');
            url.searchParams.set('q', q);
            url.searchParams.set('type', 'video');
            url.searchParams.set('videoEmbeddable', 'true');
            url.searchParams.set('maxResults', '1');
            url.searchParams.set('order', 'relevance');
            url.searchParams.set('key', apiKey);

            let response;
            try {
                response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
            } catch {
                return null;
            }
            if (!response.ok) return null;
            let payload;
            try { payload = await response.json(); } catch { return null; }
            const item = Array.isArray(payload?.items) ? payload.items[0] : null;
            const videoId = String(item?.id?.videoId || '');
            if (!videoId) return null;
            return { videoId };
        });
    }

    function isLive(match) { return match?.status === 'inprogress'; }

    function isWithin24h(match, nowMs) {
        if (!match || !match.startTimestamp) return false;
        const startMs = match.startTimestamp * 1000;
        return startMs - nowMs <= 24 * 60 * 60 * 1000 && startMs - nowMs >= 0;
    }

    function chooseState({ liveMatch, nextMatch }, nowMs) {
        if (liveMatch && isLive(liveMatch)) return 'live';
        if (isWithin24h(nextMatch, nowMs)) return 'upcoming';
        return 'finished';
    }

    function isoDate(ms) {
        return new Date(ms).toISOString().slice(0, 10);
    }

    async function getStandings(leagueId) {
        const league = getLeague(leagueId);
        if (league.supportsStandings === false) {
            return { leagueId, rows: [] };
        }
        const key = `standings:${leagueId}`;
        return cache.fetch(key, TTL.STANDINGS, async () => {
            const payload = await callFootballData(
                `/competitions/${league.footballData.code}/standings`,
            );
            const totalBlock = Array.isArray(payload?.standings)
                ? payload.standings.find((s) => s.type === 'TOTAL')
                : null;
            const tableRows = Array.isArray(totalBlock?.table) ? totalBlock.table : [];
            return {
                leagueId,
                rows: tableRows.map(normalizeStandingsRow),
            };
        });
    }

    async function getCompetitionMatchesWindow(leagueId) {
        const league = getLeague(leagueId);
        const key = `matches-window:${leagueId}`;
        return cache.fetch(key, TTL.MATCHES_WINDOW, async () => {
            const nowMs = now();
            // Wide enough window to cover international breaks, mid-season
            // gaps, and Champions teams between their league-phase fixtures.
            const dateFrom = isoDate(nowMs - 14 * 24 * 60 * 60 * 1000);
            const dateTo = isoDate(nowMs + 30 * 24 * 60 * 60 * 1000);
            const payload = await callFootballData(
                `/competitions/${league.footballData.code}/matches`,
                { dateFrom, dateTo },
            );
            const matches = Array.isArray(payload?.matches) ? payload.matches : [];
            return matches.map(normalizeMatch).filter(Boolean);
        });
    }

    async function listLeagueTeams(leagueId) {
        const league = getLeague(leagueId);
        const key = `teams:${leagueId}`;
        return cache.fetch(key, TTL.LEAGUE_TEAMS, async () => {
            const payload = await callFootballData(
                `/competitions/${league.footballData.code}/teams`,
            );
            const teams = Array.isArray(payload?.teams) ? payload.teams : [];
            return teams.map(normalizeTeam);
        });
    }

    async function searchTeams(leagueId, query) {
        const teams = await listLeagueTeams(leagueId);
        const q = expandNickname(query);
        if (!q) return teams;
        return teams.filter((team) => {
            return (
                normalizeText(team.name).includes(q) ||
                normalizeText(team.shortName).includes(q) ||
                normalizeText(team.code).includes(q)
            );
        });
    }

    async function getTeamSnapshot(leagueId, teamId) {
        const id = Number(teamId);
        if (!Number.isFinite(id) || id <= 0) {
            throw createHttpError(400, 'FOOTBALL_TEAM_ID_REQUIRED', 'A valid teamId is required.');
        }
        const league = getLeague(leagueId);

        const allMatches = await getCompetitionMatchesWindow(leagueId);
        const teamMatches = allMatches.filter(
            (m) => m.home.team.id === id || m.away.team.id === id,
        );

        const rawLiveMatch = teamMatches.find((m) => m.status === 'inprogress') ?? null;
        const finished = teamMatches
            .filter((m) => m.status === 'finished')
            .sort((a, b) => b.startTimestamp - a.startTimestamp);
        const upcoming = teamMatches
            .filter((m) => m.status === 'notstarted')
            .sort((a, b) => a.startTimestamp - b.startTimestamp);

        // Enrich the live match BEFORE deciding the snapshot's state. FotMob /
        // SofaScore detect FT well before football-data.org's free tier flips
        // IN_PLAY → FINISHED (lag of several minutes), so we trust them to mark
        // the match as actually finished. If they say it's done we promote it
        // to lastMatch and clear the live slot so the widget transitions out
        // of the 'live' state immediately.
        const enrichedLiveMatch = rawLiveMatch
            ? await tryEnrichLiveMatch(rawLiveMatch)
            : null;
        const liveSourceSaysFinished =
            enrichedLiveMatch != null && enrichedLiveMatch.status !== 'inprogress';

        const liveMatch = liveSourceSaysFinished ? null : enrichedLiveMatch;
        const lastMatch = liveSourceSaysFinished
            ? enrichedLiveMatch
            : finished[0] ?? null;
        const nextMatch = upcoming[0] ?? null;
        const state = chooseState({ liveMatch, nextMatch }, now());

        const reference = liveMatch ?? lastMatch ?? nextMatch;
        let team =
            reference?.home?.team?.id === id ? reference.home.team
                : reference?.away?.team?.id === id ? reference.away.team
                : null;

        // When the team has no matches in the window we still want a usable
        // team object (name, crest) for the empty state. Look it up in the
        // league's team catalog (already cached for 24h, so this is cheap).
        if (!team) {
            try {
                const teams = await listLeagueTeams(leagueId);
                team = teams.find((t) => t.id === id)
                    ?? { id, name: '', shortName: '', code: '', crest: '' };
            } catch {
                team = { id, name: '', shortName: '', code: '', crest: '' };
            }
        }

        const highlightSource = lastMatch ?? liveMatch ?? null;
        const highlights = highlightSource
            ? await findMatchHighlight(highlightSource, league.label)
            : null;

        return {
            state,
            team,
            lastMatch,
            nextMatch,
            liveMatch,
            highlights: highlights ?? null,
        };
    }

    // A "useful" status text either gives us a numeric minute (`67'`, `45+2'`)
    // or a recognised terminal/break label (`HT`, `FT`, `AET`, `Pen`). Only
    // truly opaque values like `In progress` or bare `LIVE` should trigger the
    // SofaScore fallback — otherwise we waste a request per snapshot during
    // halftime/fulltime windows on an endpoint that's currently 403'd by
    // Cloudflare anyway.
    function hasUsefulStatus(text) {
        if (typeof text !== 'string') return false;
        if (/\d/.test(text)) return true;
        return /^(ht|ft|aet|pen|half[- ]?time|full[- ]?time|finished|ended)$/i.test(text.trim());
    }

    async function tryEnrichLiveMatch(match) {
        let live = null;

        try {
            live = await scraper.findLiveScoreByTeams({
                homeTeamName: match.home.team.name,
                awayTeamName: match.away.team.name,
                dateUtcMs: (match.startTimestamp || 0) * 1000,
            });
        } catch (err) {
            console.warn(`[footballService] FotMob enrichment failed: ${err.message}`);
        }

        // Fall back to SofaScore when FotMob couldn't give us a parseable
        // minute. SofaScore exposes `currentPeriodStartTimestamp`, so we
        // get an exact game minute (with halftime / stoppage handled).
        if (!live || !hasUsefulStatus(live.statusText)) {
            try {
                const sofa = await sofa_findLiveScore(match);
                if (sofa) {
                    live = {
                        homeScore: sofa.homeScore ?? live?.homeScore ?? null,
                        awayScore: sofa.awayScore ?? live?.awayScore ?? null,
                        statusText: sofa.statusText || live?.statusText || '',
                    };
                }
            } catch (err) {
                console.warn(`[footballService] SofaScore enrichment failed: ${err.message}`);
            }
        }

        if (!live) return match;

        // FT / AET / Pen / "Full Time" / "Ended" → the live source confirms
        // the match is over. We flip the status here so getTeamSnapshot can
        // promote it to lastMatch and chooseState transitions out of 'live'
        // without waiting for football-data.org to catch up.
        const liveText = String(live.statusText || '').trim();
        const looksFinished = /^(ft|aet|pen|finished|full[- ]?time|ended)$/i.test(liveText);

        return {
            ...match,
            status: looksFinished ? 'finished' : match.status,
            statusDescription: liveText || match.statusDescription,
            home: {
                ...match.home,
                score: live.homeScore !== null ? live.homeScore : match.home.score,
            },
            away: {
                ...match.away,
                score: live.awayScore !== null ? live.awayScore : match.away.score,
            },
        };
    }

    async function sofa_findLiveScore(match) {
        return sofa.findLiveScoreByTeams({
            homeTeamName: match.home.team.name,
            awayTeamName: match.away.team.name,
        });
    }

    async function getTeamSnapshotByName(leagueId, name) {
        const league = getLeague(leagueId);
        const trimmed = String(name || '').trim();
        if (!trimmed) {
            throw createHttpError(400, 'FOOTBALL_TEAM_NAME_REQUIRED', 'A team name is required.');
        }

        const matches = await searchTeams(leagueId, trimmed);
        if (matches.length === 0) {
            throw createHttpError(
                404,
                'FOOTBALL_TEAM_NOT_FOUND',
                `No team in ${league.label} matches "${trimmed}".`,
            );
        }
        const lower = expandNickname(trimmed);
        const exact = matches.find(
            (t) => normalizeText(t.name) === lower || normalizeText(t.shortName) === lower,
        );
        const team = exact ?? matches[0];

        return getTeamSnapshot(leagueId, team.id);
    }

    async function getFeaturedMatch(leagueId) {
        const league = getLeague(leagueId);
        const allMatches = await getCompetitionMatchesWindow(leagueId);

        const live = allMatches.find((m) => m.status === 'inprogress');
        if (live) {
            const highlights = await findMatchHighlight(live, league.label);
            return { match: live, highlights: highlights ?? null };
        }

        const finished = allMatches
            .filter((m) => m.status === 'finished')
            .sort((a, b) => b.startTimestamp - a.startTimestamp);
        const featured = finished[0] ?? null;
        const highlights = featured ? await findMatchHighlight(featured, league.label) : null;
        return { match: featured ?? null, highlights: highlights ?? null };
    }

    return {
        getStandings,
        listLeagueTeams,
        searchTeams,
        getTeamSnapshot,
        getTeamSnapshotByName,
        getFeaturedMatch,
        getCompetitionMatchesWindow, // exposed so route can debug if needed
        _internal: { cache, callFootballData, TTL, normalizeMatch, chooseState },
    };
}

module.exports = {
    createFootballService,
};
