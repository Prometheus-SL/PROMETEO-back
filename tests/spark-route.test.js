const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function createSparkRouteApp({ sparkService, SparkRun } = {}) {
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/spark.js',
        mountPath: '/api/v1/spark',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user', username: 'migue' };
                    next();
                },
            },
            'src/services/spark/orchestrator.js': sparkService,
            'src/models/SparkRun.js': SparkRun || {},
        },
    });

    return { app, cleanup };
}

test('POST /api/v1/spark/message returns a completed Spark response', async (t) => {
    let received;
    const { app, cleanup } = createSparkRouteApp({
        sparkService: {
            handleSparkMessage: async (payload) => {
                received = payload;
                return {
                    status: 'completed',
                    message: 'He apagado las luces.',
                    toolResults: [{ name: 'lights_set_power', success: true }],
                    clientActions: [],
                };
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/spark/message')
        .send({ message: 'apaga las luces' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, 'completed');
    assert.equal(response.body.data.message, 'He apagado las luces.');
    assert.equal(received.message, 'apaga las luces');
    assert.equal(received.user._id, 'user-1');
});

test('POST /api/v1/spark/message can return browser-executable WLED jobs', async (t) => {
    const { app, cleanup } = createSparkRouteApp({
        sparkService: {
            handleSparkMessage: async () => ({
                status: 'waiting_for_client',
                runId: 'run-1',
                message: 'Necesito ejecutar una accion local.',
                clientActions: [
                    {
                        id: 'client-call-1',
                        provider: 'wled',
                        type: 'wled.set_power',
                        payload: {
                            deviceIp: '192.168.1.55',
                            useSsl: false,
                            power: 'off',
                        },
                    },
                ],
                toolResults: [],
            }),
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/spark/message')
        .send({ message: 'apaga wled' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'waiting_for_client');
    assert.equal(response.body.data.runId, 'run-1');
    assert.equal(response.body.data.clientActions[0].type, 'wled.set_power');
    assert.equal(response.body.data.clientActions[0].payload.power, 'off');
});

test('POST /api/v1/spark/runs/:runId/client-results resumes a pending run', async (t) => {
    let received;
    const { app, cleanup } = createSparkRouteApp({
        sparkService: {
            resumeSparkRun: async (payload) => {
                received = payload;
                return {
                    status: 'completed',
                    message: 'WLED apagado.',
                    clientActions: [],
                    toolResults: [{ name: 'lights_set_power', success: true }],
                };
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/spark/runs/run-1/client-results')
        .send({
            results: [
                {
                    id: 'client-call-1',
                    success: true,
                    message: 'WLED apagado',
                },
            ],
        });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, 'completed');
    assert.equal(response.body.data.message, 'WLED apagado.');
    assert.equal(received.runId, 'run-1');
    assert.equal(received.user._id, 'user-1');
    assert.equal(received.results[0].id, 'client-call-1');
});

test('POST /api/v1/spark/message applies the Spark-specific rate limit', async (t) => {
    const previousMax = process.env.SPARK_MESSAGE_RATE_LIMIT_MAX;
    const previousWindow = process.env.SPARK_MESSAGE_RATE_LIMIT_WINDOW_MS;
    process.env.SPARK_MESSAGE_RATE_LIMIT_MAX = '1';
    process.env.SPARK_MESSAGE_RATE_LIMIT_WINDOW_MS = '60000';
    t.after(() => {
        if (previousMax === undefined) delete process.env.SPARK_MESSAGE_RATE_LIMIT_MAX;
        else process.env.SPARK_MESSAGE_RATE_LIMIT_MAX = previousMax;
        if (previousWindow === undefined) delete process.env.SPARK_MESSAGE_RATE_LIMIT_WINDOW_MS;
        else process.env.SPARK_MESSAGE_RATE_LIMIT_WINDOW_MS = previousWindow;
    });

    const { app, cleanup } = createSparkRouteApp({
        sparkService: {
            handleSparkMessage: async () => ({
                status: 'completed',
                message: 'ok',
                toolResults: [],
                clientActions: [],
            }),
        },
    });
    t.after(cleanup);

    const first = await request(app)
        .post('/api/v1/spark/message')
        .send({ message: 'hola' });
    const second = await request(app)
        .post('/api/v1/spark/message')
        .send({ message: 'hola otra vez' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.success, false);
    assert.equal(second.body.error.code, 'SPARK_RATE_LIMITED');
});

test('POST /api/v1/spark/transcribe applies the Spark-specific rate limit', async (t) => {
    const previousMax = process.env.SPARK_TRANSCRIBE_RATE_LIMIT_MAX;
    const previousWindow = process.env.SPARK_TRANSCRIBE_RATE_LIMIT_WINDOW_MS;
    process.env.SPARK_TRANSCRIBE_RATE_LIMIT_MAX = '1';
    process.env.SPARK_TRANSCRIBE_RATE_LIMIT_WINDOW_MS = '60000';
    t.after(() => {
        if (previousMax === undefined) delete process.env.SPARK_TRANSCRIBE_RATE_LIMIT_MAX;
        else process.env.SPARK_TRANSCRIBE_RATE_LIMIT_MAX = previousMax;
        if (previousWindow === undefined) delete process.env.SPARK_TRANSCRIBE_RATE_LIMIT_WINDOW_MS;
        else process.env.SPARK_TRANSCRIBE_RATE_LIMIT_WINDOW_MS = previousWindow;
    });

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/spark.js',
        mountPath: '/api/v1/spark',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user', username: 'migue' };
                    next();
                },
            },
            'src/services/spark/orchestrator.js': {},
            'src/services/spark/groqClient.js': {
                transcribeAudio: async () => 'apaga las luces',
            },
        },
    });
    t.after(cleanup);

    const first = await request(app)
        .post('/api/v1/spark/transcribe')
        .attach('audio', Buffer.from('audio'), 'speech.webm');
    const second = await request(app)
        .post('/api/v1/spark/transcribe')
        .attach('audio', Buffer.from('audio'), 'speech.webm');

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.success, false);
    assert.equal(second.body.error.code, 'SPARK_RATE_LIMITED');
});
