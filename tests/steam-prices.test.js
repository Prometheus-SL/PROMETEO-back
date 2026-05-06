const assert = require('node:assert/strict');
const test = require('node:test');

const { getSteamItemPrices } = require('../src/services/steamIntegration');

function withFetchMock(mock, fn) {
    const previous = global.fetch;
    global.fetch = mock;
    return Promise.resolve()
        .then(fn)
        .finally(() => { global.fetch = previous; });
}

function withEnv(overrides, fn) {
    const previous = {};
    for (const key of Object.keys(overrides)) previous[key] = process.env[key];
    Object.assign(process.env, overrides);
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        });
}

test('getSteamItemPrices fetches missing names and caches them', async () => {
    let calls = 0;
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async () => {
            calls += 1;
            return new Response(JSON.stringify({
                success: true,
                lowest_price: '12,50€',
                median_price: '12,30€',
                volume: '1.234',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const result = await getSteamItemPrices(['A', 'B'], { appId: '730', currency: 'EUR' });
            assert.equal(calls, 2);
            assert.equal(result.prices.A.lowest, 12.50);
            assert.equal(result.prices.A.median, 12.30);
            assert.equal(result.prices.A.volume, 1234);
            assert.equal(result.prices.A.currency, 'EUR');
            assert.equal(result.cache.hits, 0);
            assert.equal(result.cache.misses, 2);
            assert.equal(result.cache.skipped, 0);

            const second = await getSteamItemPrices(['A', 'B'], { appId: '730', currency: 'EUR' });
            assert.equal(calls, 2);
            assert.equal(second.cache.hits, 2);
            assert.equal(second.cache.misses, 0);
        });
    });
});

test('getSteamItemPrices skips names beyond the wall-clock budget', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '50', STEAM_PRICE_BUDGET_MS: '200' }, async () => {
        // budget allows ~3-4 throttled fetches before 200ms; remaining names get skipped
        await withFetchMock(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return new Response(JSON.stringify({
                success: true,
                lowest_price: '1,00€',
                median_price: '1,00€',
                volume: '10',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const names = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'];
            const result = await getSteamItemPrices(names, { appId: '730', currency: 'EUR' });
            assert.ok(result.cache.skipped > 0, 'expected some prices to be skipped within budget');
            const resolvedCount = Object.values(result.prices).filter(Boolean).length;
            assert.ok(resolvedCount > 0 && resolvedCount < names.length);
        });
    });
});

test('getSteamItemPrices returns null for unparseable responses', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async () => new Response(JSON.stringify({ success: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }), async () => {
            // Use a distinct name so the cache from the first test does not collide
            const result = await getSteamItemPrices(['C_unparseable'], { appId: '730', currency: 'EUR' });
            assert.equal(result.prices.C_unparseable, null);
            assert.equal(result.cache.errors, 1);
        });
    });
});

test('getSteamItemPrices parses Spanish-format prices (1.234,56€)', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async () => new Response(JSON.stringify({
            success: true,
            lowest_price: '1.234,56€',
            median_price: '1.230,00€',
            volume: '50',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async () => {
            const result = await getSteamItemPrices(['SP_LARGE'], { appId: '730', currency: 'EUR' });
            assert.equal(result.prices.SP_LARGE.lowest, 1234.56);
            assert.equal(result.prices.SP_LARGE.median, 1230.00);
            assert.equal(result.prices.SP_LARGE.volume, 50);
        });
    });
});

test('getSteamItemPrices parses English-format prices ($1,234.50)', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async () => new Response(JSON.stringify({
            success: true,
            lowest_price: '$1,234.50',
            median_price: '$1,230.00',
            volume: '50',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async () => {
            const result = await getSteamItemPrices(['EN_LARGE'], { appId: '730', currency: 'USD' });
            assert.equal(result.prices.EN_LARGE.lowest, 1234.50);
            assert.equal(result.prices.EN_LARGE.median, 1230.00);
        });
    });
});

test('getSteamItemPrices keeps fetching skipped names in the background and warms the cache', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '40', STEAM_PRICE_BUDGET_MS: '120' }, async () => {
        let calls = 0;
        await withFetchMock(async () => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return new Response(JSON.stringify({
                success: true,
                lowest_price: '2,00€',
                median_price: '2,00€',
                volume: '5',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const names = ['BG1', 'BG2', 'BG3', 'BG4', 'BG5', 'BG6'];
            const first = await getSteamItemPrices(names, { appId: '730', currency: 'EUR' });
            // First call returns with at least one skipped name
            assert.ok(first.cache.skipped > 0, 'expected some skipped names on first call');

            // Wait long enough for background tasks to drain the queue
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Second call should hit cache for ALL names because background prefetch warmed them
            const second = await getSteamItemPrices(names, { appId: '730', currency: 'EUR' });
            assert.equal(second.cache.hits, names.length, 'all names should be cached after background prefetch');
            assert.equal(second.cache.skipped, 0);
            assert.equal(second.cache.misses, 0);
            // The total fetch count should equal the number of unique names (no duplicate fetches)
            assert.equal(calls, names.length);
        });
    });
});
