const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const fixturePath = path.join(__dirname, 'fixtures', 'epic-free-games-sample.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function withMockFetch(t, handler) {
    const original = global.fetch;
    global.fetch = handler;
    t.after(() => {
        global.fetch = original;
    });
}

test('EpicFreeGamesProvider parses and normalizes free games from fixture', async (t) => {
    const { createEpicFreeGamesProvider } = require('../src/services/discord/providers/epicFreeGames');

    withMockFetch(t, async () => ({
        ok: true,
        status: 200,
        async json() { return fixture; },
    }));

    const provider = createEpicFreeGamesProvider();
    const games = await provider.fetchCurrentFreeGames();

    assert.equal(games.length, 2, 'should return exactly the two free games from the fixture');

    const first = games.find((g) => g.id === 'offer-prop-sumo-1');
    assert.ok(first, 'Prop Sumo should be returned');
    assert.equal(first.title, 'Prop Sumo');
    assert.equal(first.priceOriginal, '9,99 €');
    assert.equal(first.imageUrl, 'https://cdn.example/prop-sumo-wide.jpg');
    assert.ok(first.storeUrl.includes('prop-sumo'));
    assert.ok(first.freeUntil instanceof Date);
    assert.equal(first.freeUntil.toISOString(), '2026-04-16T15:00:00.000Z');

    const second = games.find((g) => g.id === 'offer-second-free-3');
    assert.ok(second, 'Second Free Game should be returned');

    assert.equal(games.some((g) => g.id === 'offer-not-free-2'), false, 'paid game must be filtered out');
});

test('EpicFreeGamesProvider returns [] when no free games', async (t) => {
    const { createEpicFreeGamesProvider } = require('../src/services/discord/providers/epicFreeGames');

    withMockFetch(t, async () => ({
        ok: true,
        status: 200,
        async json() {
            return { data: { Catalog: { searchStore: { elements: [] } } } };
        },
    }));

    const provider = createEpicFreeGamesProvider();
    const games = await provider.fetchCurrentFreeGames();
    assert.deepEqual(games, []);
});

test('EpicFreeGamesProvider throws on non-OK HTTP status', async (t) => {
    const { createEpicFreeGamesProvider } = require('../src/services/discord/providers/epicFreeGames');

    withMockFetch(t, async () => ({
        ok: false,
        status: 503,
        async json() { return {}; },
    }));

    const provider = createEpicFreeGamesProvider();
    await assert.rejects(() => provider.fetchCurrentFreeGames(), /503/);
});

test('EpicFreeGamesProvider throws on malformed response', async (t) => {
    const { createEpicFreeGamesProvider } = require('../src/services/discord/providers/epicFreeGames');

    withMockFetch(t, async () => ({
        ok: true,
        status: 200,
        async json() { return { nope: true }; },
    }));

    const provider = createEpicFreeGamesProvider();
    await assert.rejects(() => provider.fetchCurrentFreeGames(), /malformed|unexpected/i);
});
