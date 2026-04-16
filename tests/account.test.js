const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/account returns the normalized account payload', async (t) => {
    const user = {
        _id: 'user-1',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        lastLogin: null,
        name: 'Mike',
        surname: 'Stone',
        birthday: null,
        linkedAccounts: {
            spotify: {
                status: 'connected',
                profile: {
                    displayName: 'Mike on Spotify',
                },
                scopes: ['user-read-private'],
                connectedAt: '2026-04-14T12:00:00.000Z',
            },
            discord: {
                status: 'disconnected',
                profile: {},
                scopes: [],
                connectedAt: null,
            },
        },
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/account.js',
        mountPath: '/api/v1/account',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = user;
                    req.auth = { sessionId: 'session-1' };
                    next();
                },
            },
            'src/models/User.js': {
                findById: async () => null,
            },
            'src/services/spotifyIntegration.js': {
                buildSpotifyAuthorizeUrl: () => '',
                completeSpotifyLink: async () => null,
                disconnectSpotifyAccount: async () => null,
            },
            'src/services/discordIntegration.js': {
                buildDiscordAuthorizeUrl: () => '',
                completeDiscordLink: async () => null,
                disconnectDiscordAccount: async () => null,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/account/');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.user.username, 'mike');
    assert.equal(response.body.data.linkedAccounts.spotify.status, 'connected');
    assert.equal(response.body.data.linkedAccounts.discord.status, 'disconnected');
});

test('GET /api/v1/account/providers returns the provider registry with live statuses', async (t) => {
    const user = {
        _id: 'user-1',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {
            spotify: {
                status: 'connected',
                profile: {
                    displayName: 'Mike on Spotify',
                },
                scopes: ['user-read-private'],
                connectedAt: '2026-04-14T12:00:00.000Z',
            },
            discord: {
                status: 'disconnected',
                profile: {},
                scopes: [],
                connectedAt: null,
            },
        },
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/account.js',
        mountPath: '/api/v1/account',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = user;
                    req.auth = { sessionId: 'session-1' };
                    next();
                },
            },
            'src/models/User.js': {
                findById: async () => null,
            },
            'src/services/spotifyIntegration.js': {
                buildSpotifyAuthorizeUrl: () => '',
                completeSpotifyLink: async () => null,
                disconnectSpotifyAccount: async () => null,
                getSpotifyStatus: async () => ({
                    status: 'connected',
                    displayName: 'Mike on Spotify',
                    avatarUrl: null,
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: ['user-read-private'],
                    lastError: null,
                    product: 'premium',
                    externalUrl: null,
                }),
            },
            'src/services/discordIntegration.js': {
                buildDiscordAuthorizeUrl: () => '',
                completeDiscordLink: async () => null,
                disconnectDiscordAccount: async () => null,
                getDiscordStatus: async () => ({
                    status: 'disconnected',
                    id: null,
                    displayName: null,
                    username: null,
                    avatarUrl: null,
                    connectedAt: null,
                    scopes: [],
                    lastError: null,
                    email: null,
                    verified: null,
                }),
            },
            'src/services/googleIntegration.js': {
                buildGoogleAuthorizeUrl: () => '',
                completeGoogleLink: async () => null,
                disconnectGoogleAccount: async () => null,
                getGoogleStatus: async () => ({
                    status: 'connected',
                    profile: {
                        email: 'mike@gmail.com',
                        displayName: 'Mike Workspace',
                    },
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: ['calendar.readonly', 'gmail.readonly'],
                    lastError: null,
                }),
            },
            'src/services/githubIntegration.js': {
                buildGithubAuthorizeUrl: () => '',
                completeGithubLink: async () => null,
                disconnectGithubAccount: async () => null,
                getGithubStatus: async () => ({
                    status: 'connected',
                    profile: {
                        login: 'mike',
                        displayName: 'Mike on GitHub',
                    },
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: ['notifications', 'repo'],
                    lastError: null,
                }),
            },
            'src/services/creatorIntegration.js': {
                getCreatorStatus: async () => ({
                    status: 'connected',
                    profile: {
                        displayName: 'Prometeo Creator',
                    },
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: [],
                    lastError: null,
                }),
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/account/providers');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.providers.length, 5);
    assert.equal(response.body.data.providers[0].id, 'spotify');
    assert.equal(response.body.data.providers[0].status, 'connected');
    assert.equal(response.body.data.providers[1].id, 'discord');
    assert.equal(response.body.data.providers[2].id, 'google');
    assert.equal(response.body.data.providers[3].id, 'github');
    assert.equal(response.body.data.providers[4].id, 'creator');
    assert.equal(response.body.data.providers[4].connectSupported, false);
});
