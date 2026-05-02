const { createHttpError } = require('../../http/errors');
const SparkRun = require('../../models/SparkRun');
const groqClient = require('./groqClient');
const {
    buildSparkToolContext,
    executeSparkTool,
} = require('./toolRegistry');

const MAX_TOOL_ITERATIONS = 4;
const RUN_TTL_MS = 10 * 60 * 1000;

function buildSystemPrompt(toolSummary) {
    const toolsText = toolSummary.length > 0
        ? toolSummary.map((item) => `- ${item.provider}: ${item.name}`).join('\n')
        : '- No hay modulos controlables configurados.';

    return [
        'Eres Spark, el asistente del dashboard PROMETEO.',
        'Responde siempre en espanol, breve y natural.',
        'Usa herramientas cuando el usuario pida consultar o controlar modulos del dashboard.',
        'Para "apaga las luces" o "enciende las luces", usa lights_set_power con provider "any" salvo que el usuario nombre LIFX o WLED.',
        'Si el usuario pide una cancion concreta en Spotify, por ejemplo "pon Time de Pink Floyd" o "quiero escuchar Blinding Lights", usa spotify_control_playback con action "play_track" y query con la peticion del usuario.',
        'Si el usuario solo quiere reanudar Spotify, usa spotify_control_playback con action "play". Si quiere pausarlo, usa action "pause".',
        'Si el usuario pide cambiar el efecto de WLED, por ejemplo "cambia el efecto del WLED" o "siguiente efecto", usa wled_next_effect.',
        'No inventes acciones si no hay herramienta disponible.',
        'Herramientas/modulos disponibles:',
        toolsText,
    ].join('\n');
}

function firstChoiceMessage(completion) {
    return completion?.choices?.[0]?.message || null;
}

function parseToolArguments(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;

    try {
        return JSON.parse(raw);
    } catch (_error) {
        return {};
    }
}

function toToolResultMessage(toolCall, execution) {
    return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function?.name,
        content: JSON.stringify({
            success: Boolean(execution.success),
            message: execution.message || '',
            data: execution.data || null,
            clientResults: execution.clientResults || undefined,
        }),
    };
}

function normalizeAssistantMessage(message) {
    return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.tool_calls,
    };
}

function clientActionResponse(action) {
    return {
        id: action.id,
        type: action.type,
        provider: action.provider,
        payload: action.payload,
    };
}

function resultResponse({ status, message, runId = null, clientActions = [], toolResults = [] }) {
    return {
        status,
        runId,
        message,
        clientActions: clientActions.map(clientActionResponse),
        toolResults,
    };
}

async function persistPendingRun({ user, messages, tools, pendingClientActions, toolResults }) {
    const run = new SparkRun({
        user: user._id,
        status: 'waiting_for_client',
        messages,
        tools,
        pendingClientActions,
        toolResults,
        expiresAt: new Date(Date.now() + RUN_TTL_MS),
    });

    await run.save();
    return run;
}

async function executeToolCalls(toolCalls, context) {
    const toolMessages = [];
    const toolResults = [];
    const clientActions = [];

    for (const toolCall of toolCalls) {
        const name = toolCall.function?.name;
        const args = parseToolArguments(toolCall.function?.arguments);
        const execution = await executeSparkTool({
            name,
            arguments: args,
            toolCallId: toolCall.id,
        }, context);

        const pendingActions = execution.clientActions || [];
        toolResults.push({
            name,
            toolCallId: toolCall.id,
            arguments: args,
            success: Boolean(execution.success),
            message: execution.message || '',
            data: execution.data || null,
            waitingForClient: pendingActions.length > 0,
        });

        if (pendingActions.length > 0) {
            clientActions.push(...pendingActions.map((action) => ({
                ...action,
                toolCallId: toolCall.id,
                toolName: name,
            })));
            continue;
        }

        toolMessages.push(toToolResultMessage(toolCall, execution));
    }

    return {
        toolMessages,
        toolResults,
        clientActions,
    };
}

async function runToolLoop({ user, messages, tools, context }) {
    const allToolResults = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const completion = await groqClient.createChatCompletion({
            messages,
            tools,
            tool_choice: tools.length > 0 ? 'auto' : 'none',
            user: String(user._id || user.username || ''),
        });
        const message = firstChoiceMessage(completion);

        if (!message) {
            throw createHttpError(502, 'SPARK_EMPTY_MODEL_RESPONSE', 'Spark did not receive a model response');
        }

        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (toolCalls.length === 0) {
            return resultResponse({
                status: 'completed',
                message: message.content || 'Listo.',
                toolResults: allToolResults,
            });
        }

        messages.push(normalizeAssistantMessage(message));
        const execution = await executeToolCalls(toolCalls, context);
        allToolResults.push(...execution.toolResults);

        if (execution.clientActions.length > 0) {
            messages.push(...execution.toolMessages);
            const run = await persistPendingRun({
                user,
                messages,
                tools,
                pendingClientActions: execution.clientActions,
                toolResults: allToolResults,
            });

            return resultResponse({
                status: 'waiting_for_client',
                runId: String(run._id),
                message: execution.toolResults.map((item) => item.message).filter(Boolean).join(' ') || 'Necesito ejecutar una accion local.',
                clientActions: execution.clientActions,
                toolResults: allToolResults,
            });
        }

        messages.push(...execution.toolMessages);
    }

    throw createHttpError(502, 'SPARK_TOOL_LOOP_LIMIT', 'Spark reached the tool execution limit');
}

async function handleSparkMessage({ user, message }) {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) {
        throw createHttpError(400, 'SPARK_MESSAGE_REQUIRED', 'message is required');
    }

    const context = await buildSparkToolContext(user);
    const messages = [
        { role: 'system', content: buildSystemPrompt(context.summary) },
        { role: 'user', content: cleanMessage },
    ];

    return runToolLoop({
        user,
        messages,
        tools: context.tools,
        context,
    });
}

function mergeClientResults(run, results) {
    const byActionId = new Map((Array.isArray(results) ? results : []).map((item) => [String(item.id), item]));
    const byToolCall = new Map();

    for (const action of run.pendingClientActions || []) {
        const result = byActionId.get(String(action.id)) || {
            id: action.id,
            success: false,
            message: 'No se recibio resultado del navegador.',
        };

        const group = byToolCall.get(action.toolCallId) || {
            toolCallId: action.toolCallId,
            toolName: action.toolName,
            clientResults: [],
        };
        group.clientResults.push(result);
        byToolCall.set(action.toolCallId, group);
    }

    return Array.from(byToolCall.values());
}

function findPendingToolResult(run, toolCallId) {
    const matches = (run.toolResults || []).filter((item) => (
        item.toolCallId === toolCallId && item.waitingForClient
    ));

    return matches[matches.length - 1] || null;
}

async function resumeSparkRun({ user, runId, results }) {
    if (!runId) {
        throw createHttpError(400, 'SPARK_RUN_ID_REQUIRED', 'runId is required');
    }

    const run = await SparkRun.findOne({
        _id: runId,
        user: user._id,
        status: 'waiting_for_client',
    });

    if (!run) {
        throw createHttpError(404, 'SPARK_RUN_NOT_FOUND', 'Spark run not found');
    }

    if (run.expiresAt && run.expiresAt < new Date()) {
        run.status = 'expired';
        await run.save();
        throw createHttpError(410, 'SPARK_RUN_EXPIRED', 'Spark run expired');
    }

    const messages = [...(run.messages || [])];
    const clientGroups = mergeClientResults(run, results);
    const resumedToolResults = [...(run.toolResults || [])];

    for (const group of clientGroups) {
        const pendingToolResult = findPendingToolResult(run, group.toolCallId);
        const success = group.clientResults.every((item) => item.success);
        const message = [
            pendingToolResult?.message,
            group.clientResults.map((item) => item.message).filter(Boolean).join(' '),
        ].filter(Boolean).join(' ');
        resumedToolResults.push({
            name: group.toolName,
            toolCallId: group.toolCallId,
            success,
            message,
            data: pendingToolResult?.data || null,
            clientResults: group.clientResults,
        });
        messages.push({
            role: 'tool',
            tool_call_id: group.toolCallId,
            name: group.toolName,
            content: JSON.stringify({
                success,
                message,
                data: pendingToolResult?.data || null,
                clientResults: group.clientResults,
            }),
        });
    }

    const context = await buildSparkToolContext(user);
    const response = await runToolLoop({
        user,
        messages,
        tools: run.tools || context.tools,
        context,
    });

    run.status = response.status === 'completed' ? 'completed' : 'waiting_for_client';
    run.messages = messages;
    run.pendingClientActions = response.clientActions || [];
    run.toolResults = resumedToolResults.concat(response.toolResults || []);
    await run.save();

    return {
        ...response,
        toolResults: run.toolResults,
    };
}

async function listSparkTools(user) {
    const context = await buildSparkToolContext(user);
    return {
        tools: context.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
        })),
        targets: context.summary,
    };
}

module.exports = {
    handleSparkMessage,
    listSparkTools,
    resumeSparkRun,
};
