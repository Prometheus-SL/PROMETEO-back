function normalizeActions(actions) {
    return Array.from(new Set(
        (Array.isArray(actions) ? actions : [])
            .map((action) => String(action || '').trim())
            .filter(Boolean)
    ));
}

function sameActions(left, right) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function mergeAiActionsIntoModules(modules, actionsByModuleId) {
    let changedCount = 0;

    const nextModules = (Array.isArray(modules) ? modules : []).map((moduleInstance) => {
        const moduleId = String(moduleInstance?.meta?.id || '').trim();
        const nextActions = normalizeActions(actionsByModuleId.get(moduleId));
        if (!moduleId || nextActions.length === 0) {
            return moduleInstance;
        }

        const currentActions = normalizeActions(moduleInstance?.meta?.ai?.actions);
        if (sameActions(currentActions, nextActions)) {
            return moduleInstance;
        }

        changedCount += 1;
        return {
            ...moduleInstance,
            meta: {
                ...(moduleInstance?.meta || {}),
                ai: {
                    actions: nextActions,
                },
            },
        };
    });

    return {
        modules: nextModules,
        changedCount,
    };
}

module.exports = {
    mergeAiActionsIntoModules,
};
