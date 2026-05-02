const { getCurrentWeather } = require('../../weatherIntegration');
const {
    getConfig,
    getModuleId,
    normalizeText,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    uniqueStrings,
} = require('../driverUtils');

const WEATHER_MODULE_IDS = new Set(['weather-widget']);
const WEATHER_ACTIONS = new Set(['weather.current']);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => WEATHER_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!WEATHER_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    const city = normalizeText(config.city);
    if (!city) return [];

    return [targetBase('weather', 'weather', moduleInstance, page, `Weather ${city}`, {
        safeKey: `weather:${city.toLowerCase()}`,
        city,
        units: ['metric', 'imperial'].includes(config.units) ? config.units : 'metric',
        language: ['es', 'en', 'fr', 'de'].includes(config.language) ? config.language : 'es',
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    if (!targets.some((target) => target.provider === 'weather' && target.aiDriverId === 'weather')) {
        return [];
    }

    return [{
        type: 'function',
        function: {
            name: 'weather_get_current',
            description: 'Read current weather from configured Weather dashboard widgets that expose AI actions.',
            parameters: {
                type: 'object',
                properties: {
                    city: { type: 'string', description: 'Optional configured city to select.' },
                },
            },
        },
    }];
}

function weatherMessage(payload) {
    const temp = Math.round(Number(payload?.main?.temp) || 0);
    const description = payload?.weather?.[0]?.description || payload?.weather?.[0]?.main || 'sin descripcion';
    const humidity = payload?.main?.humidity;
    const parts = [`${payload?.name || 'La ciudad'}: ${temp} grados, ${description}.`];
    if (humidity !== undefined) parts.push(`Humedad ${humidity}%.`);
    return parts.join(' ');
}

async function execute(call, context) {
    if (call?.name !== 'weather_get_current') {
        return null;
    }

    return safeExecute(async () => {
        const target = providerTargets(context, 'weather')
            .find((candidate) => !normalizeText(call.arguments?.city) || candidate.city.toLowerCase().includes(normalizeText(call.arguments?.city).toLowerCase()));

        if (!target) {
            return { success: false, message: 'No encontre un widget de clima configurado para esa ciudad.', clientActions: [] };
        }

        const data = await getCurrentWeather({
            city: target.city,
            units: target.units,
            language: target.language,
        });
        return okResult(weatherMessage(data), data);
    });
}

function canExecute(name) {
    return name === 'weather_get_current';
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
    driverId: 'weather',
    execute,
    getToolDefinitions,
    toSummary,
};
