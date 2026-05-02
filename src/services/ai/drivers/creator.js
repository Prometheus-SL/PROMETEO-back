const { getCreatorDashboardStatus } = require('../../creatorIntegration');
const {
    getModuleId,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    uniqueStrings,
} = require('../driverUtils');

const CREATOR_MODULE_IDS = new Set(['creator-status-widget', 'creator-status-widget-compact']);
const CREATOR_ACTIONS = new Set(['creator.status']);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => CREATOR_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!CREATOR_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    return [targetBase('creator', 'creator', moduleInstance, page, 'Creator Status', {
        safeKey: 'creator:status',
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    if (!providerTargets({ targets }, 'creator').length) return [];

    return [{
        type: 'function',
        function: {
            name: 'creator_get_status',
            description: 'Read the configured Creator Status widget for live YouTube/Twitch status.',
            parameters: { type: 'object', properties: {} },
        },
    }];
}

async function execute(call, context) {
    if (call?.name !== 'creator_get_status') {
        return null;
    }

    return safeExecute(async () => {
        if (!providerTargets(context, 'creator').length) {
            return { success: false, message: 'No encontre un widget de Creator configurado.', clientActions: [] };
        }

        const data = await getCreatorDashboardStatus();
        const live = (data.sources || [])
            .filter((source) => source.status === 'live')
            .map((source) => source.label)
            .join(', ');
        return okResult(
            data.online ? `Creator esta en directo en ${live}.` : 'Creator no esta en directo ahora mismo.',
            data
        );
    });
}

function canExecute(name) {
    return name === 'creator_get_status';
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
    driverId: 'creator',
    execute,
    getToolDefinitions,
    toSummary,
};
