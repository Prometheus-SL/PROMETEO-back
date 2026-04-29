const assert = require('node:assert/strict');
const test = require('node:test');

const {
    SUPPORTED_LEAGUE_IDS,
    getLeague,
    listLeagues,
    isSupportedLeague,
} = require('../src/services/footballLeagues');

test('listLeagues returns the laliga and champions entries with metadata', () => {
    const leagues = listLeagues();
    assert.equal(leagues.length, 2);

    const laliga = leagues.find((l) => l.id === 'laliga');
    assert.equal(laliga.label, 'LaLiga');
    assert.equal(laliga.country, 'Spain');
    assert.equal(laliga.supportsStandings, true);
    assert.equal(laliga.footballData.code, 'PD');
    assert.equal(typeof laliga.highlights.channelUrl, 'string');
    assert.equal(typeof laliga.highlights.channelLabel, 'string');

    const cl = leagues.find((l) => l.id === 'champions');
    assert.equal(cl.label, 'UEFA Champions League');
    assert.equal(cl.country, 'Europe');
    assert.equal(cl.supportsStandings, false);
    assert.equal(cl.footballData.code, 'CL');
});

test('SUPPORTED_LEAGUE_IDS contains laliga and champions', () => {
    assert.deepEqual([...SUPPORTED_LEAGUE_IDS].sort(), ['champions', 'laliga']);
});

test('getLeague returns the league entry for laliga and champions', () => {
    assert.equal(getLeague('laliga').id, 'laliga');
    assert.equal(getLeague('champions').id, 'champions');
});

test('getLeague throws when the league id is unknown', () => {
    assert.throws(
        () => getLeague('mystery-cup'),
        (err) => err.code === 'FOOTBALL_LEAGUE_UNSUPPORTED' && err.status === 400,
    );
});

test('isSupportedLeague returns true for both supported and false for unknown', () => {
    assert.equal(isSupportedLeague('laliga'), true);
    assert.equal(isSupportedLeague('champions'), true);
    assert.equal(isSupportedLeague('premier'), false);
    assert.equal(isSupportedLeague(''), false);
    assert.equal(isSupportedLeague(undefined), false);
});
