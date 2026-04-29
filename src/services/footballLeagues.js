const { createHttpError } = require('../http/errors');

// football-data.org competition codes + official YouTube channel link.
// LaLiga disables embedding on most uploads, so the frontend opens the
// channel in a new tab rather than embedding a playlist iframe.
const LEAGUES = Object.freeze({
    laliga: Object.freeze({
        id: 'laliga',
        label: 'LaLiga',
        country: 'Spain',
        footballData: Object.freeze({
            code: 'PD',
        }),
        highlights: Object.freeze({
            youtubeChannelId: 'UCTv-XvfzLX3i4IGWAm4sbmA',
            channelUrl: 'https://www.youtube.com/@LaLiga',
            channelLabel: 'LaLiga on YouTube',
        }),
    }),
});

const SUPPORTED_LEAGUE_IDS = Object.freeze(Object.keys(LEAGUES));

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
    isSupportedLeague,
    getLeague,
    listLeagues,
};
