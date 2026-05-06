const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function createSteamRouteApp(overrides = {}) {
    const state = {
        friendsCalls: [],
        dealsCalls: [],
        inventoryCalls: [],
    };

    const steamService = {
        getSteamFriendsPresence: async (user, options) => {
            state.friendsCalls.push({ user, options });
            return {
                provider: { status: 'connected' },
                profile: { steamId: '76561198000000001' },
                friends: [
                    {
                        steamId: 'friend-1',
                        personaName: 'Playing Friend',
                        personaState: 1,
                        personaStateLabel: 'online',
                        avatarUrl: null,
                        profileUrl: null,
                        game: { appId: '730', name: 'Counter-Strike 2' },
                    },
                ],
                onlineCount: 1,
                playingCount: 1,
                totalFriends: 1,
                inspectedCount: 1,
            };
        },
        getSteamDeals: async (options) => {
            state.dealsCalls.push(options);
            return {
                country: options.country,
                language: options.language,
                deals: [
                    {
                        appId: 1091500,
                        name: 'Cyberpunk 2077',
                        discountPercent: 65,
                        originalPrice: 5999,
                        finalPrice: 2099,
                        currency: 'EUR',
                        image: null,
                        largeImage: null,
                        url: 'https://store.steampowered.com/app/1091500',
                        platforms: { windows: true, mac: true, linux: false },
                    },
                ],
            };
        },
        getSteamInventorySummary: async (user, options) => {
            state.inventoryCalls.push({ user, options });
            return {
                provider: { status: 'connected' },
                appId: '730',
                appName: 'Counter-Strike 2',
                currency: 'EUR',
                totalValue: 0,
                totalItems: 0,
                totalItemsWithPrice: 0,
                totalItemsUnmarketable: 0,
                pricesPending: false,
                items: [],
                fetchedAt: '2026-05-04T00:00:00.000Z',
                cache: { inventory: 'miss', prices: { hits: 0, misses: 0, skipped: 0 } },
            };
        },
        ...overrides.steamService,
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/steam.js',
        mountPath: '/api/v1/integrations/steam',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1' };
                    next();
                },
            },
            'src/services/steamIntegration.js': steamService,
        },
    });

    return { app, cleanup, state };
}

test('GET /api/v1/integrations/steam/friends returns Steam friends presence', async (t) => {
    const { app, cleanup, state } = createSteamRouteApp();
    t.after(cleanup);

    const response = await request(app)
        .get('/api/v1/integrations/steam/friends')
        .query({ limit: '5', maxFriendsToInspect: '25' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.playingCount, 1);
    assert.equal(response.body.data.friends[0].game.name, 'Counter-Strike 2');
    assert.deepEqual(state.friendsCalls[0].options, {
        limit: '5',
        maxFriendsToInspect: '25',
    });
});

test('GET /api/v1/integrations/steam/deals returns Steam daily deals', async (t) => {
    const { app, cleanup, state } = createSteamRouteApp();
    t.after(cleanup);

    const response = await request(app)
        .get('/api/v1/integrations/steam/deals')
        .query({ country: 'ES', language: 'spanish', limit: '4' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.deals[0].discountPercent, 65);
    assert.deepEqual(state.dealsCalls[0], {
        country: 'ES',
        language: 'spanish',
        limit: '4',
    });
});

test('GET /api/v1/integrations/steam/inventory returns the summary with query params honoured', async (t) => {
    const summary = {
        provider: { status: 'connected' },
        appId: '730',
        appName: 'Counter-Strike 2',
        currency: 'EUR',
        totalValue: 51.5,
        totalItems: 3,
        totalItemsWithPrice: 2,
        totalItemsUnmarketable: 1,
        pricesPending: false,
        items: [],
        fetchedAt: '2026-05-04T00:00:00.000Z',
        cache: { inventory: 'miss', prices: { hits: 0, misses: 2, skipped: 0 } },
    };
    const inventoryCalls = [];
    const { app, cleanup } = createSteamRouteApp({
        steamService: {
            getSteamInventorySummary: async (user, options) => {
                inventoryCalls.push({ user, options });
                return summary;
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .get('/api/v1/integrations/steam/inventory')
        .query({ appId: '730', currency: 'EUR', sortBy: 'priceDesc', force: 'true' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.data, summary);

    assert.equal(inventoryCalls.length, 1);
    assert.deepEqual(inventoryCalls[0].options, {
        appId: '730', currency: 'EUR', sortBy: 'priceDesc', force: true,
    });
});

test('GET /api/v1/integrations/steam/inventory surfaces STEAM_INVENTORY_PRIVATE as 412', async (t) => {
    const { app, cleanup } = createSteamRouteApp({
        steamService: {
            getSteamInventorySummary: async () => {
                const error = new Error('Your Steam inventory is private.');
                error.status = 412;
                error.code = 'STEAM_INVENTORY_PRIVATE';
                throw error;
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/integrations/steam/inventory?appId=730');
    assert.equal(response.status, 412);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'STEAM_INVENTORY_PRIVATE');
});
