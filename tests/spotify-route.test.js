const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function createSpotifyRouteApp(overrides = {}) {
    const state = {
        transferCalls: [],
        ...overrides.state,
    };

    const spotifyService = {
        getSpotifyStatus: async () => ({ status: 'connected' }),
        getSpotifyPlaybackState: async () => null,
        getSpotifyQueue: async () => [],
        playSpotifyTrack: async () => null,
        playSpotify: async () => null,
        pauseSpotify: async () => null,
        nextSpotifyTrack: async () => null,
        previousSpotifyTrack: async () => null,
        seekSpotify: async () => null,
        setSpotifyVolume: async () => null,
        setSpotifyShuffle: async () => null,
        setSpotifyRepeat: async () => null,
        getSpotifyWebPlaybackToken: async () => ({
            accessToken: 'web-token-123',
            expiresAt: '2026-04-19T22:00:00.000Z',
            scopes: ['streaming', 'user-read-playback-state'],
        }),
        transferSpotifyPlayback: async (_user, deviceId, options = {}) => {
            state.transferCalls.push({ deviceId, options });
        },
        ...overrides.spotifyService,
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/spotify.js',
        mountPath: '/api/v1/integrations/spotify',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1' };
                    next();
                },
            },
            'src/services/spotifyIntegration.js': spotifyService,
        },
    });

    return { app, cleanup, state };
}

test('GET /api/v1/integrations/spotify/player/web-token returns a Web Playback SDK token', async (t) => {
    const { app, cleanup } = createSpotifyRouteApp();
    t.after(cleanup);

    const response = await request(app).get('/api/v1/integrations/spotify/player/web-token');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.accessToken, 'web-token-123');
    assert.deepEqual(response.body.data.scopes, ['streaming', 'user-read-playback-state']);
});

test('PUT /api/v1/integrations/spotify/player/transfer transfers playback to a browser device', async (t) => {
    const { app, cleanup, state } = createSpotifyRouteApp();
    t.after(cleanup);

    const response = await request(app)
        .put('/api/v1/integrations/spotify/player/transfer')
        .send({ deviceId: 'browser-device-1', play: true });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(state.transferCalls, [
        {
            deviceId: 'browser-device-1',
            options: { play: true },
        },
    ]);
});

test('PUT /api/v1/integrations/spotify/player/transfer rejects missing device ids', async (t) => {
    const { app, cleanup } = createSpotifyRouteApp();
    t.after(cleanup);

    const response = await request(app)
        .put('/api/v1/integrations/spotify/player/transfer')
        .send({ deviceId: '   ' });

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'SPOTIFY_DEVICE_ID_REQUIRED');
});
