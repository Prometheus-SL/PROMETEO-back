const { fetchWithTimeout, readTimeoutMs } = require('../../spark/fetchWithTimeout');
const {
    getConfig,
    getModuleId,
    normalizeText,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    targetMatches,
    uniqueStrings,
} = require('../driverUtils');

const REMOTE_FETCH_TIMEOUT_MS = readTimeoutMs(process.env.SPARK_REMOTE_FETCH_TIMEOUT_MS, 12_000);
const MINECRAFT_MODULE_IDS = new Set(['minecraft-widget']);
const MINECRAFT_ACTIONS = new Set(['minecraft.status']);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => MINECRAFT_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!MINECRAFT_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    const ipAddress = normalizeText(config.ipAddress);
    if (!ipAddress) return [];

    const port = Number(config.port);
    const address = Number.isFinite(port) && port > 0
        ? `${ipAddress}:${Math.floor(port)}`
        : ipAddress;

    return [targetBase('minecraft', 'minecraft', moduleInstance, page, normalizeText(config.name) || `Minecraft ${address}`, {
        safeKey: `minecraft:${address.toLowerCase()}`,
        address,
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    if (!providerTargets({ targets }, 'minecraft').length) {
        return [];
    }

    return [{
        type: 'function',
        function: {
            name: 'minecraft_get_status',
            description: 'Read the status and online player count of configured Minecraft server widgets that expose AI actions.',
            parameters: { type: 'object', properties: { target: { type: 'string' } } },
        },
    }];
}

async function execute(call, context) {
    if (call?.name !== 'minecraft_get_status') {
        return null;
    }

    return safeExecute(async () => {
        const target = providerTargets(context, 'minecraft')
            .find((candidate) => targetMatches(candidate, call.arguments?.target));
        if (!target) {
            return { success: false, message: 'No encontre un widget de Minecraft configurado.', clientActions: [] };
        }

        const response = await fetchWithTimeout(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(target.address)}`, {
            headers: { accept: 'application/json' },
        }, REMOTE_FETCH_TIMEOUT_MS, 'Minecraft status');
        if (!response.ok) throw new Error(`Minecraft status API error: ${response.status}`);
        const data = await response.json();

        if (!data.online) {
            return okResult(`${target.name} esta offline.`, data);
        }

        const online = data.players?.online ?? 0;
        const max = data.players?.max ?? 0;
        const names = (data.players?.list || [])
            .map((player) => player?.name_raw)
            .filter(Boolean)
            .slice(0, 5);
        const suffix = names.length ? ` Jugadores: ${names.join(', ')}.` : '';
        return okResult(`${target.name} esta online: ${online}/${max} jugadores.${suffix}`, data);
    });
}

function canExecute(name) {
    return name === 'minecraft_get_status';
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
    driverId: 'minecraft',
    execute,
    getToolDefinitions,
    toSummary,
};
