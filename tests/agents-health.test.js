const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/agents/health returns the aggregated health summary', async (t) => {
    const agents = [
        {
            _id: 'agent-1',
            agentId: 'HERMES-1',
            name: 'Hermes One',
            status: 'online',
            lastSeen: '2026-04-14T12:00:00.000Z',
            lastData: '2026-04-14T12:00:00.000Z',
            computerInfo: { hostname: 'hermes-one' },
        },
    ];

    const latestData = [
        {
            _id: 'data-1',
            agentId: 'HERMES-1',
            dataType: 'system_status',
            createdAt: '2026-04-14T12:00:00.000Z',
            data: {
                resources: {
                    cpu: { percent: 19 },
                    memory: { percent: 52 },
                    disks: [{ drive: 'C:', percent: 71 }],
                },
            },
        },
    ];

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/api/agents.js',
        mountPath: '/api/v1',
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
            'src/models/Agent.js': {
                find: async () => agents,
            },
            'src/models/AgentData.js': {
                find: () => ({
                    sort: () => ({
                        limit: async () => latestData,
                    }),
                }),
                countDocuments: async () => 0,
                aggregate: async () => [],
            },
            'src/models/User.js': {
                countDocuments: async () => 0,
            },
            'src/services/socketAgents.js': {
                listConnectedSocketSummaries() {
                    return [];
                },
                selectConnectedAgentSocket() {
                    return null;
                },
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/agents/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.summary.total, 1);
    assert.equal(response.body.data.agents[0].agentId, 'HERMES-1');
    assert.equal(response.body.data.agents[0].health.cpuPercent, 19);
});
