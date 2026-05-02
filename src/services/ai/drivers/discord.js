const discord = require('../../discord/client');
const {
    errorResult,
    getConfig,
    getModuleId,
    normalizeText,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    uniqueStrings,
} = require('../driverUtils');

const DISCORD_MODULE_IDS = new Set(['discord-widget']);
const DISCORD_ACTIONS = new Set(['discord.guild.info']);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => DISCORD_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!DISCORD_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    const serverId = normalizeText(config.serverId);
    if (!serverId) return [];

    return [targetBase('discord', 'discord', moduleInstance, page, 'Discord', {
        safeKey: `discord:${serverId}`,
        serverId,
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    if (!providerTargets({ targets }, 'discord').length) return [];

    return [{
        type: 'function',
        function: {
            name: 'discord_get_guild_info',
            description: 'Read configured Discord guild status, channels, voice rooms, and members.',
            parameters: { type: 'object', properties: {} },
        },
    }];
}

async function execute(call, context) {
    if (call?.name !== 'discord_get_guild_info') {
        return null;
    }

    return safeExecute(async () => {
        const target = providerTargets(context, 'discord')[0];
        if (!target) return errorResult('No encontre un widget de Discord configurado.');

        await discord.initBot();
        const data = await discord.getGuildInfo(target.serverId);
        const voiceCount = (data.channels || [])
            .filter((channel) => channel.type === 'voice')
            .reduce((sum, channel) => sum + Number(channel.members || 0), 0);
        return okResult(`Discord ${data.name}: ${data.memberCount || 0} miembros, ${voiceCount} en voz.`, data);
    });
}

function canExecute(name) {
    return name === 'discord_get_guild_info';
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
    driverId: 'discord',
    execute,
    getToolDefinitions,
    toSummary,
};
