const { getGoogleWorkspaceSummary } = require('../../googleIntegration');
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
    unionAllowedActions,
    uniqueStrings,
} = require('../driverUtils');

const GOOGLE_AREA_BY_ID = new Map([
    ['calendar-agenda-widget', 'calendar'],
    ['calendar-agenda-widget-compact', 'calendar'],
    ['tasks-today-widget', 'tasks'],
    ['tasks-today-widget-compact', 'tasks'],
    ['inbox-summary-widget', 'inbox'],
    ['inbox-summary-widget-compact', 'inbox'],
]);

const GOOGLE_ACTIONS = new Set([
    'google.summary.calendar',
    'google.summary.tasks',
    'google.summary.inbox',
]);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => GOOGLE_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    const area = GOOGLE_AREA_BY_ID.get(getModuleId(moduleInstance));
    if (!area) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    return [targetBase('google', 'google', moduleInstance, page, `Google ${area}`, {
        safeKey: `google:${area}`,
        area,
        maxItems: clampNumber(config.maxItems, area === 'inbox' ? 5 : 6, 1, 20),
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    const googleTargets = providerTargets({ targets }, 'google');
    if (googleTargets.length === 0) return [];

    const areas = [];
    const allowedActions = unionAllowedActions(googleTargets);
    if (allowedActions.includes('google.summary.calendar')) areas.push('calendar');
    if (allowedActions.includes('google.summary.tasks')) areas.push('tasks');
    if (allowedActions.includes('google.summary.inbox')) areas.push('inbox');
    const areaEnum = areas.length > 1 ? ['all', ...areas] : areas;

    return [{
        type: 'function',
        function: {
            name: 'google_workspace_summary',
            description: 'Read configured Calendar, Tasks, and Gmail summary widgets that expose AI actions.',
            parameters: {
                type: 'object',
                properties: {
                    area: { type: 'string', enum: areaEnum },
                },
            },
        },
    }];
}

function buildGoogleOptions(targets) {
    const byArea = new Map(targets.map((target) => [target.area, target]));
    return {
        calendar: { limit: byArea.get('calendar')?.maxItems || 6 },
        tasks: { itemsLimit: byArea.get('tasks')?.maxItems || 8 },
        inbox: { itemsLimit: byArea.get('inbox')?.maxItems || 5 },
    };
}

async function execute(call, context) {
    if (call?.name !== 'google_workspace_summary') {
        return null;
    }

    return safeExecute(async () => {
        const targets = providerTargets(context, 'google');
        if (targets.length === 0) {
            return errorResult('No encontre widgets de Google Workspace configurados.');
        }

        const area = normalizeText(call.arguments?.area || 'all');
        const requestedAction = area === 'calendar'
            ? 'google.summary.calendar'
            : area === 'tasks'
                ? 'google.summary.tasks'
                : area === 'inbox'
                    ? 'google.summary.inbox'
                    : null;

        if (requestedAction && !targets.some((target) => target.allowedAiActions.includes(requestedAction))) {
            return errorResult('Ese resumen de Google no esta expuesto por tus widgets para Spark.');
        }

        const data = await getGoogleWorkspaceSummary(context.user, buildGoogleOptions(targets));
        const messages = [];
        if (area === 'all' || area === 'calendar') {
            messages.push(data.calendar?.busyNow ? 'Calendario: tienes un evento activo.' : `Calendario: ${data.calendar?.items?.length || 0} proximos eventos.`);
        }
        if (area === 'all' || area === 'tasks') {
            messages.push(`Tareas: ${data.tasks?.dueTodayCount || 0} para hoy, ${data.tasks?.overdueCount || 0} vencidas.`);
        }
        if (area === 'all' || area === 'inbox') {
            messages.push(`Gmail: ${data.inbox?.unreadCount || 0} no leidos.`);
        }
        return okResult(messages.join(' '), data);
    });
}

function canExecute(name) {
    return name === 'google_workspace_summary';
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
    driverId: 'google',
    execute,
    getToolDefinitions,
    toSummary,
};
