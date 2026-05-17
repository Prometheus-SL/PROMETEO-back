const assert = require('node:assert/strict');
const test = require('node:test');

const driver = require('../src/services/ai/drivers/football');

function moduleInstance(config) {
    return { _id: 'fb1', meta: { id: 'football-widget-compact', name: 'Football' }, config };
}
const ACTIONS = ['football.team.summary', 'football.featured.summary', 'football.standings'];

test('collectTargets: "leagues" mode yields a null leagueId (auto-detect) not a laliga fallback', () => {
    const [t] = driver.collectTargets(moduleInstance({ leagueId: 'leagues', teamName: 'Manchester City' }), null, ACTIONS);
    assert.equal(t.leagueId, null);
    assert.equal(t.teamName, 'Manchester City');
    assert.match(t.safeKey, /^football:leagues:/);
});

test('collectTargets: empty/missing leagueId defaults to leagues mode (null), never laliga', () => {
    const [t] = driver.collectTargets(moduleInstance({ teamName: 'Inter' }), null, ACTIONS);
    assert.equal(t.leagueId, null);
});

test('collectTargets: champions stays a concrete supported id', () => {
    const [t] = driver.collectTargets(moduleInstance({ leagueId: 'champions', teamName: '' }), null, ACTIONS);
    assert.equal(t.leagueId, 'champions');
    assert.match(t.safeKey, /^football:champions:/);
});

test('collectTargets: an explicit concrete league id is preserved', () => {
    const [t] = driver.collectTargets(moduleInstance({ leagueId: 'laliga', teamName: 'Real Madrid' }), null, ACTIONS);
    assert.equal(t.leagueId, 'laliga');
});
