const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function buildMocks({ initialConfigs = [] } = {}) {
    const state = { configs: initialConfigs.slice(), savedBody: null };
    return {
        state,
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/services/discord/notificationsService.js': {
                async getStatus() {
                    return { configs: state.configs };
                },
                async saveStatus(_userId, configs) {
                    state.savedBody = configs;
                    state.configs = configs.map((c) => ({
                        guildId: c.guildId,
                        channelId: c.channelId ?? null,
                        enabled: Boolean(c.enabled),
                        lastNotifiedAt: null,
                        lastError: null,
                    }));
                    return { configs: state.configs, warning: null };
                },
            },
            'src/services/discord/client.js': {
                async initBot() { return {}; },
                getStatus() { return { connected: true, user: null, guilds: [] }; },
                async getGuildInfo() { return {}; },
                getInviteUrl() { return 'https://example/invite'; },
                async disconnectVoiceMember() { return {}; },
                async setVoiceMute() { return {}; },
                getClient() { return {}; },
            },
            'src/services/discord/userGuildsService.js': {
                async getUserAdminGuilds() { return { needsLink: false, needsReauth: false, guilds: [] }; },
            },
        },
    };
}

test('GET /api/v1/discord/notifications/epic returns current state', async (t) => {
    const { mocks } = buildMocks();
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/notifications/epic');
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.data.configs, []);
});

test('POST /api/v1/discord/notifications/epic saves multi-server configs', async (t) => {
    const { mocks, state } = buildMocks();
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const body = {
        configs: [
            { guildId: 'guild-1', channelId: 'ch-1', enabled: true },
            { guildId: 'guild-2', channelId: 'ch-2', enabled: false },
        ],
    };
    const response = await request(app)
        .post('/api/v1/discord/notifications/epic')
        .send(body);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.configs.length, 2);
    assert.deepEqual(state.savedBody, [
        { guildId: 'guild-1', channelId: 'ch-1', enabled: true },
        { guildId: 'guild-2', channelId: 'ch-2', enabled: false },
    ]);
});

test('POST /api/v1/discord/notifications/epic rejects non-array body', async (t) => {
    const { mocks } = buildMocks();
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/discord/notifications/epic')
        .send({ enabled: true });

    assert.equal(response.status, 400);
});

test('POST /api/v1/discord/notifications/epic bubbles up service errors', async (t) => {
    const { mocks } = buildMocks();
    mocks['src/services/discord/notificationsService.js'].saveStatus = async () => {
        const err = new Error('Falta channelId para activar notificaciones en guild-1');
        err.status = 400;
        throw err;
    };
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/discord/notifications/epic')
        .send({ configs: [{ guildId: 'guild-1', enabled: true }] });

    assert.equal(response.status, 400);
});
