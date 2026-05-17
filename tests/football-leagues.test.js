const assert = require('node:assert/strict');
const test = require('node:test');

const {
    SUPPORTED_LEAGUE_IDS,
    DOMESTIC_LEAGUE_IDS,
    getLeague,
    listLeagues,
    isSupportedLeague,
} = require('../src/services/footballLeagues');

test('listLeagues returns laliga, the four big leagues and champions', () => {
    const leagues = listLeagues();
    assert.equal(leagues.length, 6);

    const byId = Object.fromEntries(leagues.map((l) => [l.id, l]));

    assert.equal(byId.laliga.footballData.code, 'PD');
    assert.equal(byId.laliga.supportsStandings, true);
    assert.equal(byId.premier.label, 'Premier League');
    assert.equal(byId.premier.country, 'England');
    assert.equal(byId.premier.footballData.code, 'PL');
    assert.equal(byId.premier.supportsStandings, true);
    assert.equal(byId.bundesliga.footballData.code, 'BL1');
    assert.equal(byId.bundesliga.country, 'Germany');
    assert.equal(byId.seriea.footballData.code, 'SA');
    assert.equal(byId.seriea.country, 'Italy');
    assert.equal(byId.ligue1.footballData.code, 'FL1');
    assert.equal(byId.ligue1.country, 'France');

    for (const id of ['premier', 'bundesliga', 'seriea', 'ligue1']) {
        assert.equal(typeof byId[id].highlights.channelUrl, 'string');
        assert.equal(typeof byId[id].highlights.channelLabel, 'string');
    }

    assert.equal(byId.champions.footballData.code, 'CL');
    assert.equal(byId.champions.supportsStandings, false);
});

test('DOMESTIC_LEAGUE_IDS lists the five domestic leagues in priority order, excluding champions', () => {
    assert.deepEqual(
        [...DOMESTIC_LEAGUE_IDS],
        ['laliga', 'premier', 'bundesliga', 'seriea', 'ligue1'],
    );
    assert.equal(DOMESTIC_LEAGUE_IDS.includes('champions'), false);
});

test('SUPPORTED_LEAGUE_IDS contains all six leagues', () => {
    assert.deepEqual(
        [...SUPPORTED_LEAGUE_IDS].sort(),
        ['bundesliga', 'champions', 'laliga', 'ligue1', 'premier', 'seriea'],
    );
});

test('getLeague resolves each supported league', () => {
    for (const id of ['laliga', 'premier', 'bundesliga', 'seriea', 'ligue1', 'champions']) {
        assert.equal(getLeague(id).id, id);
    }
});

test('getLeague throws when the league id is unknown', () => {
    assert.throws(
        () => getLeague('mystery-cup'),
        (err) => err.code === 'FOOTBALL_LEAGUE_UNSUPPORTED' && err.status === 400,
    );
});

test('isSupportedLeague is true for all six and false for unknown', () => {
    for (const id of ['laliga', 'premier', 'bundesliga', 'seriea', 'ligue1', 'champions']) {
        assert.equal(isSupportedLeague(id), true);
    }
    assert.equal(isSupportedLeague('leagues'), false);
    assert.equal(isSupportedLeague(''), false);
    assert.equal(isSupportedLeague(undefined), false);
});
