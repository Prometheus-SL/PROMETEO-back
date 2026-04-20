const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('POST /control/command returns a normalized error when the agent is offline', async (t) => {
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/control.js',
        mountPath: '/control',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = {
                        _id: 'user-1',
                        username: 'mike',
                        role: 'user',
                    };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/Agent.js': {
                findOne: async () => ({
                    agentId: 'agent-1',
                    user: 'user-1',
                    status: 'offline',
                    isActive: true,
                }),
            },
            'src/models/Command.js': function MockCommand() {},
            'src/services/socketAgents.js': {
                selectConnectedAgentSocket: () => null,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/control/command')
        .send({ agentId: 'agent-1', command: 'sync' });

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'AGENT_OFFLINE');
    assert.equal(response.body.error.message, 'The agent must be online for immediate commands');
});

test('GET /control/commands returns paginated command history for privileged users', async (t) => {
    const commands = [
        {
            _id: 'cmd-doc-1',
            commandId: 'cmd-1',
            agentId: 'agent-1',
            command: 'get_system_info',
            status: 'pending',
            createdAt: '2026-04-20T10:00:00.000Z',
        },
    ];

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/control.js',
        mountPath: '/control',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = {
                        _id: 'admin-1',
                        username: 'admin',
                        role: 'admin',
                    };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/Agent.js': {},
            'src/models/Command.js': {
                find() {
                    return {
                        sort() {
                            return {
                                limit() {
                                    return {
                                        skip: async () => commands,
                                    };
                                },
                            };
                        },
                    };
                },
                countDocuments: async () => commands.length,
            },
            'src/services/socketAgents.js': {
                selectConnectedAgentSocket: () => null,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/control/commands');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.data.commands, commands);
    assert.equal(response.body.data.pagination.total, 1);
});
