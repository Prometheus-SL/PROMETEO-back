const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function buildMocks({ initialConfigs = [] } = {}) {
    const state = { configs: initialConfigs.slice(), savedBody: null, searchQuery: null };
    const mocks = {
        'src/middleware/auth.js': {
            authenticateToken(req, _res, next) {
                req.user = { _id: 'user-1', role: 'user' };
                next();
            },
            authorizeRole() { return (_req, _res, next) => next(); },
        },
        'src/services/discord/client.js': {
            async initBot() { return {}; },
            getStatus() { return { connected: true, user: null, guilds: [] }; },
            async getGuildInfo() { return {}; },
            getInviteUrl() { return 'https://example/invite'; },
            async disconnectVoiceMember() { return {}; },
            async setVoiceMute() { return {}; },
            async getMemberPermissions() { return { isAdmin: true, isOwner: false, hasLinkedDiscord: true }; },
            getClient() { return {}; },
        },
        'src/services/discord/userGuildsService.js': {
            async getUserAdminGuilds() { return { needsLink: false, needsReauth: false, guilds: [] }; },
        },
        'src/services/discord/guildConfigService.js': {
            async getStatusForUser() { return { configs: [], needsLink: false, needsReauth: false }; },
            async saveStatusForUser() { return { configs: [], warning: null }; },
        },
        'src/services/discord/gameUpdatesService.js': {
            async getStatusForUser() {
                return { configs: state.configs, needsLink: false, needsReauth: false };
            },
            async saveStatusForUser(_userId, configs) {
                state.savedBody = configs;
                state.configs = configs.map((c) => ({
                    guildId: c.guildId,
                    channelId: c.channelId ?? null,
                    enabled: Boolean(c.enabled),
                    subscriptions: (c.subscriptions ?? []).map((s) => ({
                        appId: Number(s.appId),
                        name: `App ${s.appId}`,
                        lastNotifiedAt: null,
                        lastError: null,
                    })),
                    updatedBy: 'user-1',
                    updatedAt: new Date().toISOString(),
                }));
                return { configs: state.configs, warning: null };
            },
        },
        'src/services/discord/steamCatalog.js': {
            createSteamCatalog() { return {}; },
            getSharedCatalog() {
                return {
                    search(query, { limit = 20 } = {}) {
                        state.searchQuery = { query, limit };
                        const all = [
                            { appId: 730, name: 'Counter-Strike 2' },
                            { appId: 10, name: 'Counter-Strike' },
                            { appId: 570, name: 'Dota 2' },
                        ];
                        if (!query || query.length < 2) return [];
                        return all.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
                    },
                };
            },
        },
    };
    return { state, mocks };
}

test('GET /api/v1/discord/games/search returns results', async (t) => {
    const { mocks } = buildMocks();
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const res = await request(app).get('/api/v1/discord/games/search?q=counter');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const names = res.body.data.results.map((r) => r.name);
    assert.ok(names.every((n) => /counter/i.test(n)));
});

test('GET /api/v1/discord/games/search returns [] for empty query', async (t) => {
    const { mocks } = buildMocks();
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const res = await request(app).get('/api/v1/discord/games/search?q=');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.results, []);
});

test('GET /api/v1/discord/games/search caps limit server-side at 20', async (t) => {
    const { mocks, state } = buildMocks();
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    await request(app).get('/api/v1/discord/games/search?q=counter&limit=500');
    assert.equal(state.searchQuery.limit, 20);
});

test('GET /api/v1/discord/notifications/game-updates returns current state', async (t) => {
    const { mocks } = buildMocks();
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const res = await request(app).get('/api/v1/discord/notifications/game-updates');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data.configs, []);
});

test('POST /api/v1/discord/notifications/game-updates saves configs', async (t) => {
    const { mocks, state } = buildMocks();
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const body = {
        configs: [
            { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }, { appId: 570 }] },
        ],
    };
    const res = await request(app).post('/api/v1/discord/notifications/game-updates').send(body);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.configs.length, 1);
    assert.deepEqual(state.savedBody, [
        { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }, { appId: 570 }] },
    ]);
});

test('POST /api/v1/discord/notifications/game-updates rejects non-array body', async (t) => {
    const { mocks } = buildMocks();
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const res = await request(app).post('/api/v1/discord/notifications/game-updates').send({ enabled: true });
    assert.equal(res.status, 400);
});

test('POST /api/v1/discord/notifications/game-updates bubbles up 403 from service', async (t) => {
    const { mocks } = buildMocks();
    mocks['src/services/discord/gameUpdatesService.js'].saveStatusForUser = async () => {
        const err = new Error('No eres admin/owner del servidor g-x');
        err.status = 403;
        throw err;
    };
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const res = await request(app)
        .post('/api/v1/discord/notifications/game-updates')
        .send({ configs: [{ guildId: 'g-x', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }] }] });
    assert.equal(res.status, 403);
});

test('POST /api/v1/discord/notifications/game-updates bubbles up 400 for invalid appId', async (t) => {
    const { mocks } = buildMocks();
    mocks['src/services/discord/gameUpdatesService.js'].saveStatusForUser = async () => {
        const err = new Error('appId 999999 no existe en el catálogo de Steam');
        err.status = 400;
        throw err;
    };
    const { app, cleanup } = createRouteApp({ routePath: 'src/routes/discord.js', mountPath: '/api/v1/discord', mocks });
    t.after(cleanup);

    const res = await request(app)
        .post('/api/v1/discord/notifications/game-updates')
        .send({ configs: [{ guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 999999 }] }] });
    assert.equal(res.status, 400);
});
