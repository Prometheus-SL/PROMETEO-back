function normalizeText(value) {
    return String(value || '').trim();
}

function clampNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function moduleInstanceId(moduleInstance) {
    return String(moduleInstance?._id || moduleInstance?.id || moduleInstance?.meta?.id || '');
}

function getModuleId(moduleInstance) {
    return String(moduleInstance?.meta?.id || '');
}

function getConfig(moduleInstance) {
    return moduleInstance?.config && typeof moduleInstance.config === 'object'
        ? moduleInstance.config
        : {};
}

function okResult(message, data = null) {
    return { success: true, message, clientActions: [], data };
}

function errorResult(message, data = null) {
    return { success: false, message, clientActions: [], data };
}

async function safeExecute(fn) {
    try {
        return await fn();
    } catch (error) {
        return errorResult(error?.message || 'La herramienta fallo al ejecutarse.');
    }
}

function targetMatches(target, text) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return true;

    return [
        target.name,
        target.safeKey,
        target.city,
        target.teamName,
        target.address,
        target.agentId,
        target.groupFilter,
        target.deviceIp,
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .some((value) => value.includes(normalized));
}

function firstMatchingTarget(context, predicate) {
    return (context.targets || []).find(predicate);
}

function providerTargets(context, provider, driverId = provider) {
    return (context.targets || []).filter((target) => (
        target.provider === provider
        && target.aiDriverId === driverId
    ));
}

function uniqueStrings(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeText(value))
            .filter(Boolean)
    ));
}

function targetBase(provider, driverId, moduleInstance, page, name, extra = {}) {
    return {
        provider,
        aiDriverId: driverId,
        moduleId: moduleInstanceId(moduleInstance),
        pageId: String(page?._id || ''),
        name,
        ...extra,
    };
}

function hasAllowedAction(target, actionId) {
    return Array.isArray(target?.allowedAiActions) && target.allowedAiActions.includes(actionId);
}

function unionAllowedActions(targets) {
    return Array.from(new Set(
        (targets || []).flatMap((target) => (
            Array.isArray(target.allowedAiActions) ? target.allowedAiActions : []
        ))
    ));
}

module.exports = {
    clampNumber,
    errorResult,
    firstMatchingTarget,
    getConfig,
    getModuleId,
    hasAllowedAction,
    moduleInstanceId,
    normalizeText,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    targetMatches,
    unionAllowedActions,
    uniqueStrings,
};
