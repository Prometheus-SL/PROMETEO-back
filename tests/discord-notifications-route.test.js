const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function buildMocks({ user }) {
    const state = { user, savedBody: null };
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
                    return {
                        enabled: state.user.linkedAccounts.discord.notifications.epicFreeGames.enabled,
                        channelId: state.user.linkedAccounts.discord.notifications.epicFreeGames.channelId,
                        guildId: state.user.linkedAccounts.discord.notifications.epicFreeGames.guildId,
                        lastNotifiedAt: null,
                        lastError: null,
                    };
                },
                async saveStatus(_userId, body) {
                    state.savedBody = body;
                    state.user.linkedAccounts.discord.notifications.epicFreeGames = {
                        ...state.user.linkedAccounts.discord.notifications.epicFreeGames,
                        ...body,
                    };
                    return {
                        state: {
                            enabled: body.enabled,
                            channelId: body.channelId ?? null,
                            guildId: body.guildId ?? null,
                            lastNotifiedAt: null,
                            lastError: null,
                        },
                        warning: null,
                    };
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
        },
    };
}

function makeUser() {
    return {
        linkedAccounts: {
            discord: {
                notifications: {
                    epicFreeGames: { enabled: false, channelId: null, guildId: null, lastNotifiedIds: [] },
                },
            },
        },
    };
}

test('GET /api/v1/discord/notifications/epic returns current state', async (t) => {
    const { mocks } = buildMocks({ user: makeUser() });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/notifications/epic');
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.enabled, false);
});

test('POST /api/v1/discord/notifications/epic saves state', async (t) => {
    const { mocks, state } = buildMocks({ user: makeUser() });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/discord/notifications/epic')
        .send({ enabled: true, channelId: 'channel-1', guildId: 'guild-1' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.state.enabled, true);
    assert.deepEqual(state.savedBody, { enabled: true, channelId: 'channel-1', guildId: 'guild-1' });
});

test('POST /api/v1/discord/notifications/epic rejects missing channel on enable', async (t) => {
    const mocksModule = buildMocks({ user: makeUser() });
    mocksModule.mocks['src/services/discord/notificationsService.js'].saveStatus = async () => {
        const err = new Error('channelId y guildId son obligatorios para activar notificaciones');
        err.status = 400;
        throw err;
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks: mocksModule.mocks,
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/discord/notifications/epic')
        .send({ enabled: true });

    assert.equal(response.status, 400);
});
