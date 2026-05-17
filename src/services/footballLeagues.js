const { createHttpError } = require('../http/errors');

// football-data.org competition codes + official YouTube channel link.
// LaLiga disables embedding on most uploads, so the frontend opens the
// channel in a new tab rather than embedding a playlist iframe.
const LEAGUES = Object.freeze({
    laliga: Object.freeze({
        id: 'laliga',
        label: 'LaLiga',
        country: 'Spain',
        supportsStandings: true,
        footballData: Object.freeze({
            code: 'PD',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCTv-XvfzLX3i4IGWAm4sbmA',
            channelUrl: 'https://www.youtube.com/@LaLiga',
            channelLabel: 'LaLiga on YouTube',
        }),
    }),
    premier: Object.freeze({
        id: 'premier',
        label: 'Premier League',
        country: 'England',
        supportsStandings: true,
        footballData: Object.freeze({
            code: 'PL',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCG5qGWdu8nIRZqJ_GgDwQ-w',
            channelUrl: 'https://www.youtube.com/@premierleague',
            channelLabel: 'Premier League on YouTube',
        }),
    }),
    bundesliga: Object.freeze({
        id: 'bundesliga',
        label: 'Bundesliga',
        country: 'Germany',
        supportsStandings: true,
        footballData: Object.freeze({
            code: 'BL1',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCcZdJZb8svJxNa5Ms0qPdHQ',
            channelUrl: 'https://www.youtube.com/@bundesliga',
            channelLabel: 'Bundesliga on YouTube',
        }),
    }),
    seriea: Object.freeze({
        id: 'seriea',
        label: 'Serie A',
        country: 'Italy',
        supportsStandings: true,
        footballData: Object.freeze({
            code: 'SA',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCBJeMCIeLQos7wacox4hmLQ',
            channelUrl: 'https://www.youtube.com/@SerieA',
            channelLabel: 'Serie A on YouTube',
        }),
    }),
    ligue1: Object.freeze({
        id: 'ligue1',
        label: 'Ligue 1',
        country: 'France',
        supportsStandings: true,
        footballData: Object.freeze({
            code: 'FL1',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCFKBy_e5wTqWtbDU4yiTcXg',
            channelUrl: 'https://www.youtube.com/@Ligue1',
            channelLabel: 'Ligue 1 on YouTube',
        }),
    }),
    champions: Object.freeze({
        id: 'champions',
        label: 'UEFA Champions League',
        country: 'Europe',
        supportsStandings: false,
        footballData: Object.freeze({
            code: 'CL',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCxLn7BTDBTeg-l5y4HeMVqw',
            channelUrl: 'https://www.youtube.com/@uefa',
            channelLabel: 'UEFA on YouTube',
        }),
    }),
});

const SUPPORTED_LEAGUE_IDS = Object.freeze(Object.keys(LEAGUES));

// Domestic leagues only, in tie-break priority order. Used to auto-detect a
// team's league from its name. `champions` is intentionally excluded — it is
// a separate widget mode, not a team's "home" league.
const DOMESTIC_LEAGUE_IDS = Object.freeze([
    'laliga',
    'premier',
    'bundesliga',
    'seriea',
    'ligue1',
]);

function isSupportedLeague(leagueId) {
    if (typeof leagueId !== 'string' || leagueId.length === 0) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(LEAGUES, leagueId);
}

function getLeague(leagueId) {
    if (!isSupportedLeague(leagueId)) {
        throw createHttpError(
            400,
            'FOOTBALL_LEAGUE_UNSUPPORTED',
            `League "${leagueId}" is not supported.`,
        );
    }
    return LEAGUES[leagueId];
}

function listLeagues() {
    return SUPPORTED_LEAGUE_IDS.map((id) => LEAGUES[id]);
}

module.exports = {
    SUPPORTED_LEAGUE_IDS,
    DOMESTIC_LEAGUE_IDS,
    isSupportedLeague,
    getLeague,
    listLeagues,
};
