const assert = require('node:assert/strict');
const test = require('node:test');
const mock = require('mock-require');

function loadOrchestrator({ chatResponses, toolResult, savedRuns = [] }) {
    const calls = {
        chat: [],
        executedTools: [],
        savedRuns,
    };

    mock('../src/services/spark/groqClient', {
        createChatCompletion: async (payload) => {
            calls.chat.push(payload);
            const next = chatResponses.shift();
            if (!next) throw new Error('Unexpected Groq call');
            return next;
        },
    });

    mock('../src/services/spark/toolRegistry', {
        buildSparkToolContext: async () => ({
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'lights_set_power',
                        description: 'Set lights on or off',
                        parameters: {
                            type: 'object',
                            properties: { power: { type: 'string', enum: ['on', 'off'] } },
                            required: ['power'],
                        },
                    },
                },
            ],
            summary: [{ provider: 'lifx', name: 'Desk' }],
            targets: [{ provider: 'lifx', name: 'Desk' }],
        }),
        executeSparkTool: async (call) => {
            calls.executedTools.push(call);
            return typeof toolResult === 'function' ? toolResult(call) : toolResult;
        },
    });

    mock('../src/models/SparkRun', class SparkRunMock {
        constructor(data) {
            Object.assign(this, data, { _id: 'run-db-id' });
        }

        async save() {
            calls.savedRuns.push(this);
            return this;
        }

        static async findOne(query) {
            return calls.savedRuns.find((run) => (
                String(run._id) === String(query._id)
                && String(run.user) === String(query.user)
                && run.status === query.status
            )) || null;
        }
    });

    delete require.cache[require.resolve('../src/services/spark/orchestrator')];
    const orchestrator = require('../src/services/spark/orchestrator');

    return {
        orchestrator,
        calls,
        cleanup() {
            mock.stopAll();
            delete require.cache[require.resolve('../src/services/spark/orchestrator')];
        },
    };
}

function completionWithToolCall(args) {
    return completionWithToolCalls([
        {
            id: 'call-1',
            name: 'lights_set_power',
            arguments: args,
        },
    ]);
}

function completionWithToolCalls(calls) {
    return {
        choices: [
            {
                message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: calls.map((call) => ({
                        id: call.id,
                        type: 'function',
                        function: {
                            name: call.name,
                            arguments: JSON.stringify(call.arguments),
                        },
                    })),
                },
            },
        ],
    };
}

function completionWithText(text) {
    return {
        choices: [{ message: { role: 'assistant', content: text } }],
    };
}

test('Spark orchestrator executes server tools and returns the final assistant message', async (t) => {
    const { orchestrator, calls, cleanup } = loadOrchestrator({
        chatResponses: [
            completionWithToolCall({ power: 'off' }),
            completionWithText('He apagado las luces.'),
        ],
        toolResult: {
            success: true,
            message: 'LIFX apagado',
            clientActions: [],
            data: { affected: 1 },
        },
    });
    t.after(cleanup);

    const response = await orchestrator.handleSparkMessage({
        user: { _id: 'user-1', username: 'migue' },
        message: 'apaga las luces',
    });

    assert.equal(response.status, 'completed');
    assert.equal(response.message, 'He apagado las luces.');
    assert.equal(calls.chat.length, 2);
    assert.equal(calls.executedTools[0].name, 'lights_set_power');
    assert.deepEqual(calls.executedTools[0].arguments, { power: 'off' });
});

test('Spark orchestrator includes natural-language examples for Spotify track requests in the system prompt', async (t) => {
    const { orchestrator, calls, cleanup } = loadOrchestrator({
        chatResponses: [completionWithText('Listo.')],
        toolResult: {
            success: true,
            message: 'ok',
            clientActions: [],
        },
    });
    t.after(cleanup);

    await orchestrator.handleSparkMessage({
        user: { _id: 'user-1', username: 'migue' },
        message: 'pon Time de Pink Floyd',
    });

    const systemPrompt = calls.chat[0].messages[0].content;
    assert.match(systemPrompt, /pon Time de Pink Floyd/i);
    assert.match(systemPrompt, /spotify_control_playback/i);
    assert.match(systemPrompt, /play_track/i);
});

test('Spark orchestrator stores pending runs when a tool needs browser execution', async (t) => {
    const { orchestrator, calls, cleanup } = loadOrchestrator({
        chatResponses: [completionWithToolCall({ power: 'off', provider: 'wled' })],
        toolResult: {
            success: true,
            message: 'WLED requiere ejecucion local',
            clientActions: [
                {
                    id: 'call-1:wled:http://192.168.1.55',
                    type: 'wled.set_power',
                    provider: 'wled',
                    payload: { deviceIp: '192.168.1.55', useSsl: false, power: 'off' },
                },
            ],
        },
    });
    t.after(cleanup);

    const response = await orchestrator.handleSparkMessage({
        user: { _id: 'user-1', username: 'migue' },
        message: 'apaga wled',
    });

    assert.equal(response.status, 'waiting_for_client');
    assert.equal(response.runId, 'run-db-id');
    assert.equal(response.clientActions[0].type, 'wled.set_power');
    assert.equal(calls.savedRuns.length, 1);
    assert.equal(calls.savedRuns[0].status, 'waiting_for_client');
});

test('Spark orchestrator resumes mixed server and browser results with the original server data', async (t) => {
    const { orchestrator, calls, cleanup } = loadOrchestrator({
        chatResponses: [
            completionWithToolCall({ power: 'off' }),
            completionWithText('Todas las luces apagadas.'),
        ],
        toolResult: {
            success: true,
            message: 'LIFX apagado. WLED requiere ejecucion local.',
            clientActions: [
                {
                    id: 'call-1:wled:http://192.168.1.55',
                    type: 'wled.set_power',
                    provider: 'wled',
                    payload: { deviceIp: '192.168.1.55', useSsl: false, power: 'off' },
                },
            ],
            data: {
                serverResults: [{ provider: 'lifx', target: 'LIFX Desk', success: true }],
            },
        },
    });
    t.after(cleanup);

    const pending = await orchestrator.handleSparkMessage({
        user: { _id: 'user-1', username: 'migue' },
        message: 'apaga las luces',
    });

    const resumed = await orchestrator.resumeSparkRun({
        user: { _id: 'user-1', username: 'migue' },
        runId: pending.runId,
        results: [
            {
                id: 'call-1:wled:http://192.168.1.55',
                success: true,
                message: 'WLED apagado.',
            },
        ],
    });

    assert.equal(resumed.status, 'completed');
    const finalMessages = calls.chat[1].messages;
    const toolMessage = finalMessages.find((message) => message.role === 'tool' && message.tool_call_id === 'call-1');
    assert.ok(toolMessage, 'resume should send the tool result back to Groq');
    const content = JSON.parse(toolMessage.content);
    assert.match(content.message, /LIFX apagado/);
    assert.equal(content.data.serverResults[0].provider, 'lifx');
    assert.equal(content.clientResults[0].message, 'WLED apagado.');
});

test('Spark orchestrator preserves completed tool messages while waiting for browser tool calls', async (t) => {
    const { orchestrator, calls, cleanup } = loadOrchestrator({
        chatResponses: [
            completionWithToolCalls([
                { id: 'server-call', name: 'server_tool', arguments: { mode: 'status' } },
                { id: 'client-call', name: 'client_tool', arguments: { power: 'off' } },
            ]),
            completionWithText('Listo.'),
        ],
        toolResult: (call) => {
            if (call.name === 'server_tool') {
                return {
                    success: true,
                    message: 'Servidor listo',
                    clientActions: [],
                    data: { checked: true },
                };
            }

            return {
                success: true,
                message: 'Cliente pendiente',
                clientActions: [
                    {
                        id: 'client-call:wled:http://192.168.1.55',
                        type: 'wled.set_power',
                        provider: 'wled',
                        payload: { deviceIp: '192.168.1.55', useSsl: false, power: 'off' },
                    },
                ],
            };
        },
    });
    t.after(cleanup);

    const pending = await orchestrator.handleSparkMessage({
        user: { _id: 'user-1', username: 'migue' },
        message: 'consulta y apaga',
    });

    await orchestrator.resumeSparkRun({
        user: { _id: 'user-1', username: 'migue' },
        runId: pending.runId,
        results: [
            {
                id: 'client-call:wled:http://192.168.1.55',
                success: true,
                message: 'Cliente listo',
            },
        ],
    });

    const finalToolMessages = calls.chat[1].messages.filter((message) => message.role === 'tool');
    assert.deepEqual(
        finalToolMessages.map((message) => message.tool_call_id).sort(),
        ['client-call', 'server-call']
    );
});
