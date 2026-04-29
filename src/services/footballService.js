const { createHttpError } = require('../http/errors');
const { createCache } = require('./footballCache');
const { getLeague } = require('./footballLeagues');

const FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';

// TTLs aligned with the 10 req/min free tier of football-data.org.
const TTL = Object.freeze({
    STANDINGS: 5 * 60 * 1000,        // 5 min
    MATCHES_WINDOW: 60 * 1000,       // 1 min — short to capture live updates.
    LEAGUES: 24 * 60 * 60 * 1000,    // 24h — static metadata.
});

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

function createFootballService({ fetch = globalThis.fetch, now = () => Date.now() } = {}) {
    const cache = createCache({ now });

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
            const dateFrom = isoDate(nowMs - 7 * 24 * 60 * 60 * 1000);
            const dateTo = isoDate(nowMs + 14 * 24 * 60 * 60 * 1000);
            const payload = await callFootballData(
                `/competitions/${league.footballData.code}/matches`,
                { dateFrom, dateTo },
            );
            const matches = Array.isArray(payload?.matches) ? payload.matches : [];
            return matches.map(normalizeMatch).filter(Boolean);
        });
    }

    async function listLeagueTeams(leagueId) {
        const standings = await getStandings(leagueId);
        return standings.rows.map((row) => row.team);
    }

    async function searchTeams(leagueId, query) {
        const teams = await listLeagueTeams(leagueId);
        const q = String(query || '').trim().toLowerCase();
        if (!q) return teams;
        return teams.filter((team) => {
            return (
                team.name.toLowerCase().includes(q) ||
                team.shortName.toLowerCase().includes(q) ||
                team.code.toLowerCase().includes(q)
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

        const liveMatch = teamMatches.find((m) => m.status === 'inprogress') ?? null;
        const finished = teamMatches
            .filter((m) => m.status === 'finished')
            .sort((a, b) => b.startTimestamp - a.startTimestamp);
        const upcoming = teamMatches
            .filter((m) => m.status === 'notstarted')
            .sort((a, b) => a.startTimestamp - b.startTimestamp);

        const lastMatch = finished[0] ?? null;
        const nextMatch = upcoming[0] ?? null;
        const state = chooseState({ liveMatch, nextMatch }, now());

        const reference = liveMatch ?? lastMatch ?? nextMatch;
        const team =
            reference?.home?.team?.id === id ? reference.home.team
                : reference?.away?.team?.id === id ? reference.away.team
                : { id, name: '', shortName: '', code: '', crest: '' };

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
        const lower = trimmed.toLowerCase();
        const exact = matches.find(
            (t) => t.name.toLowerCase() === lower || t.shortName.toLowerCase() === lower,
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
