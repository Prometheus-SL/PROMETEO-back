const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/creator/status returns the creator sources summary', async (t) => {
    const status = {
        online: true,
        liveCount: 1,
        sources: [
            {
                id: 'youtube',
                label: 'YouTube',
                status: 'live',
                headline: 'PROMETEO Deep Dive',
            },
            {
                id: 'twitch',
                label: 'Twitch',
                status: 'offline',
                headline: 'Waiting for stream',
            },
        ],
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/creator.js',
        mountPath: '/api/v1/creator',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
            },
            'src/services/creatorIntegration.js': {
                getCreatorDashboardStatus: async () => status,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/creator/status');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.online, true);
    assert.equal(response.body.data.sources[0].id, 'youtube');
});
