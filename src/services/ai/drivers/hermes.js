const { randomUUID } = require('crypto');

const Agent = require('../../../models/Agent');
const AgentData = require('../../../models/AgentData');
const Command = require('../../../models/Command');
const { getIo } = require('../../notifications');
const { selectConnectedAgentSocket } = require('../../socketAgents');
const {
    clampNumber,
    errorResult,
    getConfig,
    getModuleId,
    normalizeText,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    targetMatches,
    unionAllowedActions,
    uniqueStrings,
} = require('../driverUtils');

const HERMES_CAPABILITY_BY_ID = new Map([
    ['hermes-pc-widget', 'system'],
    ['hermes-now-playing-widget', 'media'],
    ['hermes-volume-widget', 'audio'],
]);

const AI_ACTION_TO_COMMAND = {
    'hermes.command.volume.set': 'volume_set',
    'hermes.command.volume.mute': 'volume_mute',
    'hermes.command.volume.unmute': 'volume_unmute',
    'hermes.command.volume.up': 'volume_up',
    'hermes.command.volume.down': 'volume_down',
    'hermes.command.audio_output.set': 'audio_output_set',
    'hermes.command.media.refresh': 'media_refresh',
    'hermes.command.media.toggle_playback': 'media_toggle_playback',
    'hermes.command.media.play': 'media_play',
    'hermes.command.media.pause': 'media_pause',
    'hermes.command.media.next': 'media_next',
    'hermes.command.media.previous': 'media_previous',
};

const COMMAND_TO_AI_ACTION = Object.fromEntries(
    Object.entries(AI_ACTION_TO_COMMAND).map(([aiAction, command]) => [command, aiAction])
);

const HERMES_ACTIONS = new Set([
    'hermes.status.system',
    'hermes.status.audio',
    'hermes.status.media',
    ...Object.keys(AI_ACTION_TO_COMMAND),
]);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => HERMES_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    const capability = HERMES_CAPABILITY_BY_ID.get(getModuleId(moduleInstance));
    if (!capability) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    const mode = config.mode === 'agent' ? 'agent' : 'auto';
    const agentId = normalizeText(config.agentId);
    if (mode !== 'auto' && !agentId) return [];

    return [targetBase('hermes', 'hermes', moduleInstance, page, `Hermes ${capability}`, {
        safeKey: `hermes:${mode === 'agent' ? agentId : 'auto'}:${capability}`,
        mode,
        agentId,
        capability,
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    const hermesTargets = providerTargets({ targets }, 'hermes');
    if (hermesTargets.length === 0) return [];

    const tools = [];
    const allowedActions = unionAllowedActions(hermesTargets);
    const areas = [];
    if (allowedActions.includes('hermes.status.system')) areas.push('system');
    if (allowedActions.includes('hermes.status.audio')) areas.push('audio');
    if (allowedActions.includes('hermes.status.media')) areas.push('media');

    if (areas.length > 0) {
        tools.push({
            type: 'function',
            function: {
                name: 'hermes_get_status',
                description: 'Read configured Hermes agent system, audio, or now-playing status.',
                parameters: {
                    type: 'object',
                    properties: {
                        area: { type: 'string', enum: areas },
                        agentId: { type: 'string' },
                    },
                },
            },
        });
    }

    const commands = allowedActions
        .map((actionId) => AI_ACTION_TO_COMMAND[actionId])
        .filter(Boolean);

    if (commands.length > 0) {
        tools.push({
            type: 'function',
            function: {
                name: 'hermes_control',
                description: 'Send safe media or volume commands to configured Hermes agents.',
                parameters: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            enum: commands,
                        },
                        agentId: { type: 'string' },
                        volumePercent: { type: 'number', minimum: 0, maximum: 100 },
                        outputId: { type: 'string' },
                    },
                    required: ['command'],
                },
            },
        });
    }

    return tools;
}

async function findLatestAgentData(agentId, dataType) {
    const query = AgentData.findOne({ agentId, dataType }).sort({ createdAt: -1 });
    return typeof query.lean === 'function' ? query.lean() : query;
}

async function findOwnedHermesAgent(query) {
    const result = Agent.findOne(query);
    if (result && typeof result.select === 'function') {
        return result.select('-apiKey');
    }

    return result;
}

async function findOwnedHermesAgents(query) {
    let result = Agent.find(query).sort({ status: -1, lastSeen: -1, createdAt: -1 });
    if (result && typeof result.select === 'function') {
        result = result.select('-apiKey');
    }
    if (result && typeof result.limit === 'function') {
        result = result.limit(10);
    }

    return result;
}

function serializeHermesAgent(agent) {
    const source = agent && typeof agent.toObject === 'function' ? agent.toObject() : agent;
    if (!source) return null;

    return {
        _id: source._id ? String(source._id) : undefined,
        agentId: source.agentId || null,
        name: source.name || null,
        status: source.status || 'offline',
        lastSeen: source.lastSeen || null,
        lastData: source.lastData || null,
        updatedAt: source.updatedAt || null,
        computerInfo: source.computerInfo ? {
            hostname: source.computerInfo.hostname || null,
            os: source.computerInfo.os ? {
                platform: source.computerInfo.os.platform || null,
                release: source.computerInfo.os.release || null,
                arch: source.computerInfo.os.arch || null,
            } : undefined,
            network: source.computerInfo.network ? {
                ip: source.computerInfo.network.ip || null,
            } : undefined,
        } : undefined,
    };
}

async function resolveHermesAgent(context, args = {}) {
    const requestedAgentId = normalizeText(args.agentId);
    const targets = providerTargets(context, 'hermes');
    if (requestedAgentId && targets.length > 0) {
        const requested = await findOwnedHermesAgent({
            agentId: requestedAgentId,
            user: context.user._id,
            isActive: { $ne: false },
        });
        if (requested) return requested;
        return null;
    }

    const directTarget = requestedAgentId
        ? targets.find((target) => target.agentId === requestedAgentId || targetMatches(target, requestedAgentId))
        : targets.find((target) => target.mode === 'agent' && target.agentId);

    if (directTarget?.agentId) {
        const agent = await findOwnedHermesAgent({
            agentId: directTarget.agentId,
            user: context.user._id,
            isActive: { $ne: false },
        });
        if (!agent) return null;
        return agent;
    }

    const agents = await findOwnedHermesAgents({
        user: context.user._id,
        isActive: { $ne: false },
    });
    return (agents || []).find((agent) => agent.status === 'online') || agents?.[0] || null;
}

function isStatusAreaAllowed(targets, area) {
    const actionId = `hermes.status.${area}`;
    return targets.some((target) => target.allowedAiActions.includes(actionId));
}

function buildHermesParameters(args) {
    const params = {};
    if (args.volumePercent !== undefined) {
        params.volumePercent = clampNumber(args.volumePercent, 50, 0, 100);
    }
    if (args.outputId) {
        params.outputId = normalizeText(args.outputId);
    }
    return params;
}

async function execute(call, context) {
    if (call?.name !== 'hermes_get_status' && call?.name !== 'hermes_control') {
        return null;
    }

    return safeExecute(async () => {
        const targets = providerTargets(context, 'hermes');
        if (targets.length === 0) {
            return null;
        }

        if (call.name === 'hermes_get_status') {
            const area = normalizeText(call.arguments?.area || 'system');
            if (!isStatusAreaAllowed(targets, area)) {
                return errorResult('Ese estado de Hermes no esta expuesto por tus widgets para Spark.');
            }

            const agent = await resolveHermesAgent(context, call.arguments);
            if (!agent) return errorResult('No encontre un agente Hermes configurado para tu usuario.');

            const dataType = area === 'media' ? 'media_update' : 'system_status';
            const latest = await findLatestAgentData(agent.agentId, dataType);
            const payload = latest?.data || null;
            if (!payload) {
                return okResult(`Hermes ${agent.name || agent.agentId}: sin datos recientes.`, {
                    agent: serializeHermesAgent(agent),
                    latest: null,
                });
            }

            if (area === 'media') {
                const media = payload.media || {};
                return okResult(
                    media.title ? `Hermes esta reproduciendo ${media.title}${media.artist ? ` de ${media.artist}` : ''}.` : 'Hermes no tiene media activa.',
                    { agent: serializeHermesAgent(agent), latest: payload }
                );
            }

            if (area === 'audio') {
                const audio = payload.audio || {};
                return okResult(
                    audio.available ? `Hermes audio al ${audio.volumePercent ?? '?'}%${audio.muted ? ', silenciado' : ''}.` : 'Hermes audio no disponible.',
                    { agent: serializeHermesAgent(agent), latest: payload }
                );
            }

            const cpu = payload.resources?.cpu?.percent;
            const memory = payload.resources?.memory?.percent;
            return okResult(
                `Hermes ${agent.name || agent.agentId}: ${agent.status}. CPU ${cpu ?? '?'}%, memoria ${memory ?? '?'}%.`,
                { agent: serializeHermesAgent(agent), latest: payload }
            );
        }

        const command = normalizeText(call.arguments?.command);
        const actionId = COMMAND_TO_AI_ACTION[command];
        if (!actionId) {
            return errorResult('Ese comando Hermes no esta permitido desde Spark.');
        }
        if (!targets.some((target) => target.allowedAiActions.includes(actionId))) {
            return errorResult('Ese comando Hermes no esta expuesto por tus widgets para Spark.');
        }

        const agent = await resolveHermesAgent(context, call.arguments);
        if (!agent) return errorResult('No encontre un agente Hermes configurado para tu usuario.');
        if (agent.status !== 'online') {
            return errorResult(`Hermes ${agent.name || agent.agentId} esta offline.`);
        }

        const commandDoc = new Command({
            commandId: randomUUID(),
            agentId: agent.agentId,
            sentBy: context.user.username || String(context.user._id),
            command,
            parameters: buildHermesParameters(call.arguments || {}),
            priority: 'normal',
            scheduledFor: new Date(),
        });
        await commandDoc.save();

        const io = getIo();
        const targetSocket = io ? selectConnectedAgentSocket(io, agent.agentId, command) : null;
        if (targetSocket) {
            targetSocket.emit('command', {
                commandId: commandDoc.commandId,
                command_type: commandDoc.command,
                command: commandDoc.command,
                parameters: commandDoc.parameters,
                priority: commandDoc.priority,
                sentBy: context.user.username || String(context.user._id),
                timestamp: new Date().toISOString(),
            });
            await commandDoc.markAsSent();
        }

        return okResult(
            targetSocket
                ? `Comando Hermes enviado: ${command}.`
                : `Comando Hermes encolado: ${command}.`,
            { commandId: commandDoc.commandId, status: commandDoc.status }
        );
    });
}

function canExecute(name) {
    return name === 'hermes_get_status' || name === 'hermes_control';
}

function toSummary(target) {
    return {
        provider: target.provider,
        name: target.name || target.safeKey,
        safeKey: target.safeKey,
    };
}

module.exports = {
    canExecute,
    collectTargets,
    driverId: 'hermes',
    execute,
    getToolDefinitions,
    toSummary,
};
