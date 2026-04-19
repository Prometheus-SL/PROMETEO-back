const test = require('node:test');
const assert = require('node:assert/strict');

const { createSteamCatalog } = require('../src/services/discord/steamCatalog');

function makeSearchFetch(itemsByTerm) {
    return async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/storesearch/')) {
            const term = parsed.searchParams.get('term') ?? '';
            const items = itemsByTerm[term] ?? [];
            return {
                ok: true,
                status: 200,
                async json() {
                    return { total: items.length, items };
                },
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };
}

function makeAppdetailsFetch(namesByAppId) {
    return async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/api/appdetails') {
            const appId = Number(parsed.searchParams.get('appids'));
            const name = namesByAppId[appId];
            return {
                ok: true,
                status: 200,
                async json() {
                    if (name == null) return { [appId]: { success: false } };
                    return { [appId]: { success: true, data: { name, steam_appid: appId } } };
                },
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };
}

test('search returns matches from storesearch mapped to { appId, name }', async () => {
    const catalog = createSteamCatalog({
        fetch: makeSearchFetch({
            counter: [
                { type: 'app', id: 730, name: 'Counter-Strike 2' },
                { type: 'app', id: 10, name: 'Counter-Strike' },
            ],
        }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const results = await catalog.search('counter');
    assert.deepEqual(results, [
        { appId: 730, name: 'Counter-Strike 2' },
        { appId: 10, name: 'Counter-Strike' },
    ]);
});

test('search respects limit and caps at 20', async () => {
    const items = Array.from({ length: 30 }, (_v, i) => ({
        type: 'app',
        id: i + 1,
        name: `Game ${i + 1}`,
    }));
    const catalog = createSteamCatalog({
        fetch: makeSearchFetch({ game: items }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal((await catalog.search('game', { limit: 5 })).length, 5);
    assert.equal((await catalog.search('game', { limit: 100 })).length, 20);
});

test('search excludes soundtracks, DLCs, demos, betas, trailers, tools', async () => {
    const catalog = createSteamCatalog({
        fetch: makeSearchFetch({
            'counter-strike': [
                { type: 'app', id: 1, name: 'Counter-Strike 2' },
                { type: 'app', id: 2, name: 'Counter-Strike 2 Soundtrack' },
                { type: 'app', id: 3, name: 'Counter-Strike 2 - OST' },
                { type: 'app', id: 4, name: 'Counter-Strike 2 DLC Pack' },
                { type: 'app', id: 5, name: 'Counter-Strike 2 Demo' },
                { type: 'app', id: 6, name: 'Counter-Strike 2 Beta' },
                { type: 'app', id: 7, name: 'Counter-Strike 2 Trailer' },
                { type: 'app', id: 8, name: 'Counter-Strike 2 Dedicated Server' },
                { type: 'app', id: 9, name: 'Counter-Strike 2 Playtest' },
                { type: 'app', id: 10, name: 'Counter-Strike 2 Pre-Order Bonus' },
                { type: 'app', id: 11, name: 'Counter-Strike 2 Deluxe Upgrade' },
                { type: 'app', id: 12, name: 'Counter-Strike 2 Season Pass' },
            ],
        }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const results = await catalog.search('counter-strike', { limit: 50 });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Counter-Strike 2');
});

test('search returns [] for queries shorter than 2 chars without hitting fetch', async () => {
    let calls = 0;
    const catalog = createSteamCatalog({
        fetch: async () => { calls += 1; return { ok: true, status: 200, async json() { return { items: [] }; } }; },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.deepEqual(await catalog.search(''), []);
    assert.deepEqual(await catalog.search('a'), []);
    assert.deepEqual(await catalog.search('   '), []);
    assert.equal(calls, 0);
});

test('search returns [] when storesearch responds non-ok', async () => {
    const catalog = createSteamCatalog({
        fetch: async () => ({ ok: false, status: 500, async json() { return {}; } }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.deepEqual(await catalog.search('counter'), []);
});

test('getName caches results so subsequent calls skip HTTP', async () => {
    let calls = 0;
    const catalog = createSteamCatalog({
        fetch: async (url) => {
            calls += 1;
            const appId = Number(new URL(url).searchParams.get('appids'));
            return {
                ok: true,
                status: 200,
                async json() { return { [appId]: { success: true, data: { name: `App ${appId}` } } }; },
            };
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(await catalog.getName(730), 'App 730');
    assert.equal(await catalog.getName(730), 'App 730');
    assert.equal(calls, 1);
});

test('getName returns null when appdetails reports success=false', async () => {
    const catalog = createSteamCatalog({
        fetch: makeAppdetailsFetch({}),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(await catalog.getName(999999), null);
});

test('search primes the name cache so getName does not need HTTP', async () => {
    let appdetailsCalls = 0;
    const fetchFn = async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/storesearch/')) {
            return {
                ok: true,
                status: 200,
                async json() {
                    return { items: [{ type: 'app', id: 730, name: 'Counter-Strike 2' }] };
                },
            };
        }
        if (parsed.pathname === '/api/appdetails') {
            appdetailsCalls += 1;
            return { ok: true, status: 200, async json() { return {}; } };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const catalog = createSteamCatalog({
        fetch: fetchFn,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await catalog.search('counter');
    assert.equal(await catalog.getName(730), 'Counter-Strike 2');
    assert.equal(appdetailsCalls, 0);
});
