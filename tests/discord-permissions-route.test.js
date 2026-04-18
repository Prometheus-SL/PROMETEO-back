const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function buildBaseMocks({ discordId = null, permResult, permError } = {}) {
    return {
        'src/middleware/auth.js': {
            authenticateToken(req, _res, next) {
                req.user = { _id: 'user-1', role: 'user' };
                next();
            },
            authorizeRole() { return (_req, _res, next) => next(); },
        },
        'src/models/User.js': {
            findById() {
                return {
                    lean: async () => ({
                        linkedAccounts: {
                            discord: {
                                status: discordId ? 'connected' : 'disconnected',
                                profile: { id: discordId },
                            },
                        },
                    }),
                };
            },
        },
        'src/services/discord/notificationsService.js': {
            async getStatus() { return {}; },
            async saveStatus() { return {}; },
        },
        'src/services/discord/client.js': {
            async initBot() { return {}; },
            getStatus() { return { connected: true, user: null, guilds: [] }; },
            async getGuildInfo() { return {}; },
            getInviteUrl() { return 'https://example/invite'; },
            async disconnectVoiceMember() { return {}; },
            async setVoiceMute() { return {}; },
            async getMemberPermissions(_guildId, userId) {
                if (permError) throw permError;
                return permResult ?? { isAdmin: false, isOwner: false, hasLinkedDiscord: Boolean(userId) };
            },
            async getWidgetGuildsForUser() { return []; },
            getClient() { return {}; },
        },
    };
}

test('GET me/permissions returns hasLinkedDiscord false when no link', async (t) => {
    const mocks = buildBaseMocks({ discordId: null });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/guilds/guild-1/me/permissions');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { isAdmin: false, isOwner: false, hasLinkedDiscord: false });
});

test('GET me/permissions returns result from service when linked', async (t) => {
    const mocks = buildBaseMocks({
        discordId: 'dc-42',
        permResult: { isAdmin: true, isOwner: false, hasLinkedDiscord: true },
    });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/guilds/guild-1/me/permissions');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { isAdmin: true, isOwner: false, hasLinkedDiscord: true });
});

test('GET me/permissions surfaces 404 when bot is not in guild', async (t) => {
    const mocks = buildBaseMocks({
        discordId: 'dc-42',
        permError: Object.assign(new Error('El bot no está en ese servidor'), { status: 404 }),
    });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/guilds/ghost/me/permissions');
    assert.equal(response.status, 404);
});
