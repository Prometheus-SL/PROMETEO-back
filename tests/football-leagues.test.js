const assert = require('node:assert/strict');
const test = require('node:test');

const {
    SUPPORTED_LEAGUE_IDS,
    getLeague,
    listLeagues,
    isSupportedLeague,
} = require('../src/services/footballLeagues');

test('listLeagues returns the laliga entry with footballData code + highlights channel', () => {
    const leagues = listLeagues();
    assert.equal(leagues.length, 1);
    const laliga = leagues[0];
    assert.equal(laliga.id, 'laliga');
    assert.equal(laliga.label, 'LaLiga');
    assert.equal(laliga.country, 'Spain');
    assert.equal(typeof laliga.footballData.code, 'string');
    assert.equal(laliga.footballData.code, 'PD');
    assert.equal(typeof laliga.highlights.channelUrl, 'string');
    assert.ok(laliga.highlights.channelUrl.length > 0);
    assert.equal(typeof laliga.highlights.channelLabel, 'string');
    assert.ok(laliga.highlights.channelLabel.length > 0);
});

test('SUPPORTED_LEAGUE_IDS contains laliga only', () => {
    assert.deepEqual([...SUPPORTED_LEAGUE_IDS], ['laliga']);
});

test('getLeague returns the league entry for a supported id', () => {
    const league = getLeague('laliga');
    assert.equal(league.id, 'laliga');
});

test('getLeague throws when the league id is unknown', () => {
    assert.throws(
        () => getLeague('mystery-cup'),
        (err) => err.code === 'FOOTBALL_LEAGUE_UNSUPPORTED' && err.status === 400,
    );
});

test('isSupportedLeague returns true for supported and false for unknown', () => {
    assert.equal(isSupportedLeague('laliga'), true);
    assert.equal(isSupportedLeague('champions'), false);
    assert.equal(isSupportedLeague(''), false);
    assert.equal(isSupportedLeague(undefined), false);
});
