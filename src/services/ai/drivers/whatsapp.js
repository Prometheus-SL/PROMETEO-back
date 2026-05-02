const whatsapp = require('../../whatsapp/client');
const {
    clampNumber,
    errorResult,
    getConfig,
    getModuleId,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    uniqueStrings,
} = require('../driverUtils');

const WHATSAPP_MODULE_IDS = new Set(['whatsapp-personal-widget']);
const WHATSAPP_ACTIONS = new Set(['whatsapp.status', 'whatsapp.conversations.list']);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => WHATSAPP_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!WHATSAPP_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    return [targetBase('whatsapp', 'whatsapp', moduleInstance, page, 'WhatsApp', {
        safeKey: 'whatsapp:personal',
        limit: clampNumber(config.limit, 8, 3, 20),
        includeGroups: config.includeGroups !== false,
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    const whatsappTargets = providerTargets({ targets }, 'whatsapp');
    if (whatsappTargets.length === 0) return [];

    const tools = [];
    if (whatsappTargets.some((target) => target.allowedAiActions.includes('whatsapp.status'))) {
        tools.push({
            type: 'function',
            function: {
                name: 'whatsapp_get_status',
                description: 'Read WhatsApp connection status for configured WhatsApp widgets that expose AI actions.',
                parameters: { type: 'object', properties: {} },
            },
        });
    }
    if (whatsappTargets.some((target) => target.allowedAiActions.includes('whatsapp.conversations.list'))) {
        tools.push({
            type: 'function',
            function: {
                name: 'whatsapp_list_conversations',
                description: 'Read recent WhatsApp conversations from configured WhatsApp widgets that expose AI actions.',
                parameters: {
                    type: 'object',
                    properties: {
                        limit: { type: 'number', minimum: 1, maximum: 20 },
                        includeGroups: { type: 'boolean' },
                    },
                },
            },
        });
    }
    return tools;
}

async function execute(call, context) {
    if (call?.name !== 'whatsapp_get_status' && call?.name !== 'whatsapp_list_conversations') {
        return null;
    }

    return safeExecute(async () => {
        const target = providerTargets(context, 'whatsapp')[0];
        if (!target) return errorResult('No encontre un widget de WhatsApp configurado.');

        if (call.name === 'whatsapp_get_status') {
            if (!target.allowedAiActions.includes('whatsapp.status')) {
                return errorResult('Este widget de WhatsApp no expone el estado a Spark.');
            }

            await whatsapp.ensureClient(context.user);
            const data = whatsapp.getStatus(context.user);
            return okResult(`WhatsApp: ${data.state === 'ready' ? 'conectado' : data.state || 'no listo'}.`, data);
        }

        if (!target.allowedAiActions.includes('whatsapp.conversations.list')) {
            return errorResult('Este widget de WhatsApp no expone conversaciones a Spark.');
        }

        const limit = clampNumber(call.arguments?.limit, target.limit, 1, 20);
        const includeGroups = call.arguments?.includeGroups ?? target.includeGroups;
        const data = await whatsapp.fetchConversations(context.user, limit, { includeGroups });
        const names = (data.conversations || data || [])
            .slice(0, 5)
            .map((item) => item.name || item.title || item.id)
            .filter(Boolean);
        return okResult(
            names.length ? `WhatsApp: conversaciones recientes con ${names.join(', ')}.` : 'WhatsApp: no encontre conversaciones recientes.',
            data
        );
    });
}

function canExecute(name) {
    return name === 'whatsapp_get_status' || name === 'whatsapp_list_conversations';
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
    driverId: 'whatsapp',
    execute,
    getToolDefinitions,
    toSummary,
};
