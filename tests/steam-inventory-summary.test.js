const assert = require('node:assert/strict');
const test = require('node:test');

const { getSteamInventorySummary } = require('../src/services/steamIntegration');

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

function makeUser(steamId = '76561198000000888') {
    return {
        _id: 'user-1',
        linkedAccounts: {
            steam: {
                status: 'connected',
                profile: { steamId },
                scopes: ['openid'],
            },
        },
    };
}

function makeInventoryPayload(prefix) {
    return {
        success: true,
        assets: [
            { appid: 730, classid: `${prefix}_C1`, instanceid: `${prefix}_I1`, assetid: '1' },
            { appid: 730, classid: `${prefix}_C2`, instanceid: `${prefix}_I2`, assetid: '2' },
            { appid: 730, classid: `${prefix}_C3`, instanceid: `${prefix}_I3`, assetid: '3' },
            { appid: 730, classid: `${prefix}_C3`, instanceid: `${prefix}_I3`, assetid: '4' },
        ],
        descriptions: [
            { classid: `${prefix}_C1`, instanceid: `${prefix}_I1`, market_hash_name: `CHEAP_${prefix}`, marketable: 1, tradable: 1 },
            { classid: `${prefix}_C2`, instanceid: `${prefix}_I2`, market_hash_name: `EXPENSIVE_${prefix}`, marketable: 1, tradable: 1 },
            { classid: `${prefix}_C3`, instanceid: `${prefix}_I3`, market_hash_name: `SOUVENIR_${prefix}`, marketable: 0, tradable: 0 },
        ],
    };
}

test('getSteamInventorySummary computes total, sorts by priceDesc, excludes unmarketable from total', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async (url) => {
            const u = String(url);
            if (u.includes('/inventory/')) {
                return new Response(JSON.stringify(makeInventoryPayload('T1')), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            const name = new URL(u).searchParams.get('market_hash_name');
            const lowest = name === 'CHEAP_T1' ? '1,50€' : '50,00€';
            const median = name === 'CHEAP_T1' ? '1,40€' : '49,80€';
            return new Response(JSON.stringify({
                success: true, lowest_price: lowest, median_price: median, volume: '100',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const summary = await getSteamInventorySummary(makeUser('76561198000000801'), {
                appId: '730', currency: 'EUR', sortBy: 'priceDesc',
            });

            assert.equal(summary.appId, '730');
            assert.equal(summary.appName, 'Counter-Strike 2');
            assert.equal(summary.currency, 'EUR');
            assert.equal(summary.totalItems, 3);
            assert.equal(summary.totalItemsWithPrice, 2);
            assert.equal(summary.totalItemsUnmarketable, 1);
            assert.equal(summary.totalValue, 51.5);
            assert.deepEqual(
                summary.items.map((it) => it.marketHashName),
                ['EXPENSIVE_T1', 'CHEAP_T1', 'SOUVENIR_T1'],
            );
            assert.equal(summary.items[2].price, null);
        });
    });
});

test('getSteamInventorySummary sets pricesPending when budget skips some prices', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '100', STEAM_PRICE_BUDGET_MS: '150' }, async () => {
        await withFetchMock(async (url) => {
            const u = String(url);
            if (u.includes('/inventory/')) {
                return new Response(JSON.stringify(makeInventoryPayload('T2')), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
            return new Response(JSON.stringify({
                success: true, lowest_price: '1,00€', median_price: '1,00€', volume: '10',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const summary = await getSteamInventorySummary(makeUser('76561198000000802'), {
                appId: '730', currency: 'EUR', sortBy: 'priceDesc',
            });
            assert.equal(summary.pricesPending, true);
        });
    });
});

test('getSteamInventorySummary throws STEAM_INVENTORY_EMPTY when assets is empty', async () => {
    await withFetchMock(async () => new Response(JSON.stringify({
        success: true, assets: [], descriptions: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async () => {
        await assert.rejects(
            getSteamInventorySummary(makeUser('76561198000000803'), { appId: '730', currency: 'EUR' }),
            (error) => error.code === 'STEAM_INVENTORY_EMPTY',
        );
    });
});

test('getSteamInventorySummary sorts by name (case-insensitive) and ignores price presence', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async (url) => {
            const u = String(url);
            if (u.includes('/inventory/')) {
                return new Response(JSON.stringify({
                    success: true,
                    assets: [
                        { appid: 730, classid: 'T4_C1', instanceid: 'T4_I1', assetid: '1' },
                        { appid: 730, classid: 'T4_C2', instanceid: 'T4_I2', assetid: '2' },
                        { appid: 730, classid: 'T4_C3', instanceid: 'T4_I3', assetid: '3' },
                    ],
                    descriptions: [
                        { classid: 'T4_C1', instanceid: 'T4_I1', market_hash_name: 'banana_T4', marketable: 1, tradable: 1 },
                        { classid: 'T4_C2', instanceid: 'T4_I2', market_hash_name: 'Apple_T4', marketable: 0, tradable: 0 },
                        { classid: 'T4_C3', instanceid: 'T4_I3', market_hash_name: 'cherry_T4', marketable: 1, tradable: 1 },
                    ],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({
                success: true, lowest_price: '1,00€', median_price: '1,00€', volume: '5',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const summary = await getSteamInventorySummary(makeUser('76561198000000804'), {
                appId: '730', currency: 'EUR', sortBy: 'name',
            });
            // Case-insensitive alphabetical: Apple, banana, cherry — unmarketable Apple still ordered with the rest
            assert.deepEqual(
                summary.items.map((it) => it.marketName),
                ['Apple_T4', 'banana_T4', 'cherry_T4'],
            );
        });
    });
});

test('getSteamInventorySummary sorts by dateDesc using the latest assetid per stack', async () => {
    await withEnv({ STEAM_PRICE_THROTTLE_MS: '0', STEAM_PRICE_BUDGET_MS: '5000' }, async () => {
        await withFetchMock(async (url) => {
            const u = String(url);
            if (u.includes('/inventory/')) {
                return new Response(JSON.stringify({
                    success: true,
                    assets: [
                        { appid: 730, classid: 'T5_C1', instanceid: 'T5_I1', assetid: '500' },
                        { appid: 730, classid: 'T5_C2', instanceid: 'T5_I2', assetid: '900' },
                        { appid: 730, classid: 'T5_C3', instanceid: 'T5_I3', assetid: '100' },
                        // duplicate of T5_C3 with much higher assetid
                        { appid: 730, classid: 'T5_C3', instanceid: 'T5_I3', assetid: '950' },
                    ],
                    descriptions: [
                        { classid: 'T5_C1', instanceid: 'T5_I1', market_hash_name: 'OLD_T5', marketable: 1, tradable: 1 },
                        { classid: 'T5_C2', instanceid: 'T5_I2', market_hash_name: 'MID_T5', marketable: 1, tradable: 1 },
                        { classid: 'T5_C3', instanceid: 'T5_I3', market_hash_name: 'NEW_T5', marketable: 1, tradable: 1 },
                    ],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({
                success: true, lowest_price: '1,00€', median_price: '1,00€', volume: '5',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }, async () => {
            const desc = await getSteamInventorySummary(makeUser('76561198000000805'), {
                appId: '730', currency: 'EUR', sortBy: 'dateDesc',
            });
            // NEW (highest 950) > MID (900) > OLD (500). Newest first.
            assert.deepEqual(
                desc.items.map((it) => it.marketName),
                ['NEW_T5', 'MID_T5', 'OLD_T5'],
            );

            const asc = await getSteamInventorySummary(makeUser('76561198000000805'), {
                appId: '730', currency: 'EUR', sortBy: 'dateAsc',
            });
            assert.deepEqual(
                asc.items.map((it) => it.marketName),
                ['OLD_T5', 'MID_T5', 'NEW_T5'],
            );
        });
    });
});
