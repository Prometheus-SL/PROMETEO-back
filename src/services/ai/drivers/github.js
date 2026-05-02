const { getGithubPulse } = require('../../githubIntegration');
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

const GITHUB_MODULE_IDS = new Set(['github-pulse-widget', 'github-pulse-widget-compact']);
const GITHUB_ACTIONS = new Set(['github.pulse']);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => GITHUB_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!GITHUB_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    return [targetBase('github', 'github', moduleInstance, page, 'GitHub Pulse', {
        safeKey: 'github:pulse',
        maxItems: clampNumber(config.maxItems, 6, 1, 12),
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    if (!providerTargets({ targets }, 'github').length) return [];

    return [{
        type: 'function',
        function: {
            name: 'github_get_pulse',
            description: 'Read the configured GitHub Pulse widget: notifications, mentions, pull requests, and failing checks.',
            parameters: { type: 'object', properties: {} },
        },
    }];
}

async function execute(call, context) {
    if (call?.name !== 'github_get_pulse') {
        return null;
    }

    return safeExecute(async () => {
        const target = providerTargets(context, 'github')[0];
        if (!target) return errorResult('No encontre un widget de GitHub configurado.');

        const data = await getGithubPulse(context.user, {
            notificationsLimit: target.maxItems,
            pullsLimit: target.maxItems,
        });
        return okResult(
            `GitHub: ${data.notifications?.length || 0} notificaciones, ${data.mentionsCount || 0} menciones, ${data.failingChecksCount || 0} PRs con checks fallando.`,
            data
        );
    });
}

function canExecute(name) {
    return name === 'github_get_pulse';
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
    driverId: 'github',
    execute,
    getToolDefinitions,
    toSummary,
};
