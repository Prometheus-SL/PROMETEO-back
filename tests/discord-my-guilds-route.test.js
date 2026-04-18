const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function buildMocks({ result } = {}) {
    return {
        'src/middleware/auth.js': {
            authenticateToken(req, _res, next) {
                req.user = { _id: 'user-1', role: 'user' };
                next();
            },
            authorizeRole() { return (_req, _res, next) => next(); },
        },
        'src/services/discord/notificationsService.js': {
            async getStatus() { return { configs: [] }; },
            async saveStatus() { return { configs: [], warning: null }; },
        },
        'src/services/discord/client.js': {
            async initBot() { return {}; },
            getStatus() { return { connected: true, user: null, guilds: [] }; },
            async getGuildInfo() { return {}; },
            getInviteUrl() { return 'https://example/invite'; },
            async disconnectVoiceMember() { return {}; },
            async setVoiceMute() { return {}; },
            async getMemberPermissions() { return { isAdmin: false, isOwner: false, hasLinkedDiscord: false }; },
            getClient() { return {}; },
        },
        'src/services/discord/userGuildsService.js': {
            async getUserAdminGuilds() {
                return result ?? { needsLink: false, needsReauth: false, guilds: [] };
            },
        },
    };
}

test('GET my-guilds returns needsLink when user has no Discord linked', async (t) => {
    const mocks = buildMocks({ result: { needsLink: true, needsReauth: false, guilds: [] } });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/my-guilds');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { needsLink: true, needsReauth: false, guilds: [] });
});

test('GET my-guilds returns needsReauth when scope is missing', async (t) => {
    const mocks = buildMocks({ result: { needsLink: false, needsReauth: true, guilds: [] } });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/my-guilds');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.needsReauth, true);
    assert.deepEqual(response.body.data.guilds, []);
});

test('GET my-guilds returns admin/owner guilds with bot presence flag', async (t) => {
    const mocks = buildMocks({
        result: {
            needsLink: false,
            needsReauth: false,
            guilds: [
                { id: 'g-1', name: 'Alpha', icon: null, isAdmin: true, isOwner: false, hasLinkedDiscord: true, botPresent: true },
                { id: 'g-2', name: 'Beta', icon: 'http://icon', isAdmin: false, isOwner: true, hasLinkedDiscord: true, botPresent: false },
            ],
        },
    });
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/discord.js',
        mountPath: '/api/v1/discord',
        mocks,
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/discord/my-guilds');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.guilds.length, 2);
    assert.equal(response.body.data.guilds[0].botPresent, true);
    assert.equal(response.body.data.guilds[1].botPresent, false);
    assert.equal(response.body.data.guilds[0].isAdmin, true);
    assert.equal(response.body.data.guilds[1].isOwner, true);
});
