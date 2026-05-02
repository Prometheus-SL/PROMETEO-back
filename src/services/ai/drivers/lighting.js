const { fetchWithTimeout, readTimeoutMs } = require('../../spark/fetchWithTimeout');
const {
    errorResult,
    getConfig,
    getModuleId,
    hasAllowedAction,
    moduleInstanceId,
    normalizeText,
    providerTargets,
    safeExecute,
    targetBase,
    targetMatches,
    unionAllowedActions,
    uniqueStrings,
} = require('../driverUtils');

const LIFX_API_BASE = 'https://api.lifx.com/v1';
const LIGHTING_FETCH_TIMEOUT_MS = readTimeoutMs(process.env.SPARK_REMOTE_FETCH_TIMEOUT_MS, 12_000);

const LIFX_MODULE_IDS = new Set(['lifx-widget']);
const WLED_MODULE_IDS = new Set(['wled-controller', 'wled-compact']);
const LIGHTING_ACTIONS = new Set(['lighting.power.set', 'lighting.effect.next']);

function normalizeDeviceAddress(value) {
    const raw = normalizeText(value);
    if (!raw) return '';

    return raw
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/g, '');
}

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => LIGHTING_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    const id = getModuleId(moduleInstance);
    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    const instanceId = moduleInstanceId(moduleInstance);

    if (LIFX_MODULE_IDS.has(id)) {
        const apiToken = normalizeText(config.apiToken);
        if (!apiToken) return [];

        const groupFilter = normalizeText(config.groupFilter);
        return [targetBase('lifx', 'lighting', moduleInstance, page, groupFilter ? `LIFX ${groupFilter}` : 'LIFX lights', {
            safeKey: `lifx:${instanceId || groupFilter || 'all'}`,
            apiToken,
            groupFilter,
            allowedAiActions: allowedAiActions.filter((actionId) => actionId === 'lighting.power.set'),
        })].filter((target) => target.allowedAiActions.length > 0);
    }

    if (WLED_MODULE_IDS.has(id)) {
        const deviceIp = normalizeDeviceAddress(config.deviceIp);
        if (!deviceIp) return [];

        const useSsl = Boolean(config.useSsl);
        const protocol = useSsl ? 'https' : 'http';
        return [targetBase('wled', 'lighting', moduleInstance, page, `WLED ${deviceIp}`, {
            safeKey: `wled:${protocol}://${deviceIp}`,
            deviceIp,
            useSsl,
            allowedAiActions,
        })];
    }

    return [];
}

function providersEnum(targets) {
    return Array.from(new Set(
        targets
            .filter((target) => hasAllowedAction(target, 'lighting.power.set'))
            .map((target) => target.provider)
    )).sort();
}

function getToolDefinitions(targets) {
    const lightingTargets = targets.filter((target) => target.aiDriverId === 'lighting');
    if (lightingTargets.length === 0) return [];

    const tools = [];
    const providers = providersEnum(lightingTargets);
    if (providers.length > 0) {
        tools.push({
            type: 'function',
            function: {
                name: 'lights_set_power',
                description: [
                    'Turn configured dashboard lights on or off.',
                    'Use this when the user asks to turn lights, LIFX, WLED, LEDs, tira LED, or smart-home lighting on or off.',
                    'When the user says "las luces" and no provider is specified, use provider "any".',
                ].join(' '),
                parameters: {
                    type: 'object',
                    properties: {
                        power: {
                            type: 'string',
                            enum: ['on', 'off'],
                            description: 'Desired power state.',
                        },
                        provider: {
                            type: 'string',
                            enum: ['any', ...providers],
                            description: 'Optional provider filter. Use any unless the user names LIFX or WLED.',
                        },
                        target: {
                            type: 'string',
                            description: 'Optional light group, device name, or all.',
                        },
                    },
                    required: ['power'],
                },
            },
        });
    }

    if (lightingTargets.some((target) => target.provider === 'wled' && hasAllowedAction(target, 'lighting.effect.next'))) {
        tools.push({
            type: 'function',
            function: {
                name: 'wled_next_effect',
                description: 'Move configured WLED widgets to the next effect. Use this when the user asks for the next WLED effect or to change the effect.',
                parameters: {
                    type: 'object',
                    properties: {
                        target: {
                            type: 'string',
                            description: 'Optional WLED device name, IP, or all.',
                        },
                    },
                },
            },
        });
    }

    return tools;
}

function lifxSelectorForTarget(target) {
    if (target.groupFilter) {
        return `group:${encodeURIComponent(target.groupFilter)}`;
    }

    return 'all';
}

async function lifxRequest(target, endpoint) {
    const selector = lifxSelectorForTarget(target);
    const response = await fetchWithTimeout(`${LIFX_API_BASE}/lights/${selector}/${endpoint}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${target.apiToken}`,
            'Content-Type': 'application/json',
        },
    }, LIGHTING_FETCH_TIMEOUT_MS, 'LIFX request');

    if (!response.ok) {
        throw new Error(`LIFX API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text().catch(() => '');
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch (_error) {
        return null;
    }
}

function toTargetName(target) {
    if (target.provider === 'lifx') {
        return target.groupFilter ? `LIFX ${target.groupFilter}` : 'LIFX lights';
    }

    if (target.provider === 'wled') {
        return `WLED ${target.deviceIp}`;
    }

    return target.safeKey;
}

function matchesProvider(target, provider) {
    return !provider || provider === 'any' || target.provider === provider;
}

function matchesTarget(target, requestedTarget) {
    const normalized = normalizeText(requestedTarget).toLowerCase();
    if (!normalized || normalized === 'all' || normalized === 'todas' || normalized === 'todo') {
        return true;
    }

    return targetMatches(target, requestedTarget);
}

async function executeServerTarget(target, power) {
    if (target.provider !== 'lifx') {
        return null;
    }

    await lifxRequest(target, power === 'on' ? 'on' : 'off');

    return {
        provider: 'lifx',
        target: toTargetName(target),
        success: true,
        message: `${toTargetName(target)} ${power === 'on' ? 'encendida' : 'apagada'}`,
    };
}

function createClientExecution(target, power, toolCallId) {
    if (target.provider !== 'wled') {
        return null;
    }

    return {
        id: `${toolCallId || 'call'}:${target.safeKey}`,
        provider: 'wled',
        type: 'wled.set_power',
        payload: {
            deviceIp: target.deviceIp,
            useSsl: target.useSsl,
            power,
        },
    };
}

function createWledNextEffectExecution(target, toolCallId) {
    if (target.provider !== 'wled') {
        return null;
    }

    return {
        id: `${toolCallId || 'call'}:${target.safeKey}:next-effect`,
        provider: 'wled',
        type: 'wled.next_effect',
        payload: {
            deviceIp: target.deviceIp,
            useSsl: target.useSsl,
        },
    };
}

function summarizeBatchResult({ successMessage, emptyMessage, affectedItems, clientActions, errors, data }) {
    const affected = affectedItems.length + clientActions.length;
    const failed = errors.length;
    const parts = [];
    if (affectedItems.length > 0) parts.push(`${affectedItems.length} servidor`);
    if (clientActions.length > 0) parts.push(`${clientActions.length} local`);
    if (failed > 0) parts.push(`${failed} error`);

    return {
        success: affected > 0 && failed === 0,
        message: parts.length > 0
            ? `${successMessage}: ${parts.join(', ')}.`
            : emptyMessage,
        clientActions,
        data: {
            ...data,
            affected,
            failed,
            errors,
        },
    };
}

async function execute(call, context) {
    if (call?.name !== 'lights_set_power' && call?.name !== 'wled_next_effect') {
        return null;
    }

    return safeExecute(async () => {
        const targets = providerTargets(context, 'lifx', 'lighting')
            .concat(providerTargets(context, 'wled', 'lighting'));
        if (targets.length === 0) {
            return null;
        }

        if (call.name === 'wled_next_effect') {
            const requestedTarget = call.arguments?.target;
            const matched = targets
                .filter((target) => target.provider === 'wled')
                .filter((target) => hasAllowedAction(target, 'lighting.effect.next'))
                .filter((target) => matchesTarget(target, requestedTarget));

            if (matched.length === 0) {
                return errorResult('No encontre dispositivos WLED configurados para esa peticion.');
            }

            const clientActions = matched
                .map((target) => createWledNextEffectExecution(target, call.toolCallId))
                .filter(Boolean);

            return summarizeBatchResult({
                successMessage: 'Siguiente efecto WLED preparado',
                emptyMessage: 'No se pudo preparar el siguiente efecto de WLED.',
                affectedItems: [],
                clientActions,
                errors: [],
                data: {
                    action: 'next_effect',
                    targets: matched.map((target) => toTargetName(target)),
                },
            });
        }

        const power = call.arguments?.power === 'on' ? 'on' : call.arguments?.power === 'off' ? 'off' : null;
        if (!power) {
            return errorResult('Debes indicar si quieres encender o apagar las luces.');
        }

        const provider = normalizeText(call.arguments?.provider || 'any').toLowerCase();
        const requestedTarget = call.arguments?.target;
        const matched = targets
            .filter((target) => hasAllowedAction(target, 'lighting.power.set'))
            .filter((target) => matchesProvider(target, provider))
            .filter((target) => matchesTarget(target, requestedTarget));

        if (matched.length === 0) {
            return errorResult('No encontre luces configuradas para esa peticion.');
        }

        const serverResults = [];
        const clientActions = [];
        const errors = [];

        for (const target of matched) {
            try {
                const serverResult = await executeServerTarget(target, power);
                if (serverResult) {
                    serverResults.push(serverResult);
                    continue;
                }

                const clientAction = createClientExecution(target, power, call.toolCallId);
                if (clientAction) {
                    clientActions.push(clientAction);
                }
            } catch (error) {
                errors.push({
                    provider: target.provider,
                    target: toTargetName(target),
                    message: error.message,
                });
            }
        }

        return summarizeBatchResult({
            successMessage: `Luces ${power === 'on' ? 'encendidas' : 'apagadas'}`,
            emptyMessage: 'No se pudo ejecutar la accion de luces.',
            affectedItems: serverResults,
            clientActions,
            errors,
            data: {
                power,
                serverResults,
            },
        });
    });
}

function canExecute(name) {
    return name === 'lights_set_power' || name === 'wled_next_effect';
}

function toSummary(target) {
    return {
        provider: target.provider,
        name: toTargetName(target),
        safeKey: target.safeKey,
    };
}

module.exports = {
    canExecute,
    collectTargets,
    driverId: 'lighting',
    execute,
    getToolDefinitions,
    toSummary,
};
