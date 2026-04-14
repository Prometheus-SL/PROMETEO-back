const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/dashboard/feed returns linked-account alerts and recent agent activity', async (t) => {
    const user = {
        _id: 'user-1',
        role: 'user',
        linkedAccounts: {
            spotify: {
                status: 'reauth_required',
                lastError: 'Reconnect Spotify',
            },
            discord: {
                status: 'connected',
                profile: {
                    displayName: 'Prometeo Discord',
                },
            },
        },
    };

    const latestData = [
        {
            _id: 'data-1',
            agentId: 'HERMES-1',
            dataType: 'system_status',
            createdAt: '2026-04-14T12:00:00.000Z',
            data: {
                system: { hostname: 'hermes-one' },
                resources: {
                    cpu: { percent: 22 },
                },
            },
        },
    ];

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/dashboard.js',
        mountPath: '/api/v1/dashboard',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = user;
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/DashboardPage.js': {
                find() {
                    return {
                        sort: async () => [],
                    };
                },
                findOne: async () => null,
            },
            'src/models/Agent.js': {
                find: async () => [
                    {
                        _id: 'agent-1',
                        agentId: 'HERMES-1',
                        name: 'Hermes One',
                        status: 'online',
                    },
                ],
            },
            'src/models/AgentData.js': {
                find: () => ({
                    sort: () => ({
                        limit: async () => latestData,
                    }),
                }),
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/dashboard/feed');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.items.length, 2);
    assert.equal(response.body.data.items[0].type, 'linked-account');
    assert.equal(response.body.data.items[1].type, 'agent-data');
});
