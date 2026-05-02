const drivers = require('./drivers');
const { uniqueStrings } = require('./driverUtils');
const driversById = new Map(drivers.map((driver) => [driver.driverId, driver]));

function normalizeWidgetActions(moduleInstance) {
    return uniqueStrings(moduleInstance?.meta?.ai?.actions);
}

function hasWidgetAiConfig(moduleInstance) {
    return groupActionsByDriver(normalizeWidgetActions(moduleInstance)).size > 0;
}

function groupActionsByDriver(actionIds) {
    const grouped = new Map();

    for (const actionId of actionIds) {
        const driverId = actionId.split('.')[0];
        if (!driversById.has(driverId)) continue;
        const existing = grouped.get(driverId) || [];
        existing.push(actionId);
        grouped.set(driverId, existing);
    }

    return grouped;
}

function buildToolsFromTargets(targets) {
    const toolMap = new Map();

    for (const driver of drivers) {
        for (const tool of driver.getToolDefinitions(targets)) {
            if (!toolMap.has(tool.function.name)) {
                toolMap.set(tool.function.name, tool);
            }
        }
    }

    return Array.from(toolMap.values());
}

function summarizeTargets(targets) {
    return targets.map((target) => {
        const driver = driversById.get(target.aiDriverId);
        return driver?.toSummary?.(target) || {
            provider: target.provider,
            name: target.name || target.safeKey,
            safeKey: target.safeKey,
        };
    });
}

function buildWidgetAiContext({ user, pages }) {
    const targets = [];

    for (const page of pages || []) {
        for (const moduleInstance of page.modules || []) {
            const actionIds = normalizeWidgetActions(moduleInstance);
            if (actionIds.length === 0) continue;

            const grouped = groupActionsByDriver(actionIds);
            for (const [driverId, driverActions] of grouped.entries()) {
                const driver = driversById.get(driverId);
                if (!driver) continue;
                targets.push(...driver.collectTargets(moduleInstance, page, driverActions));
            }
        }
    }

    return {
        user,
        targets,
        tools: buildToolsFromTargets(targets),
        summary: summarizeTargets(targets),
    };
}

async function executeWidgetAiTool(call, context) {
    for (const driver of drivers) {
        if (!driver.canExecute(call?.name)) continue;
        const result = await driver.execute(call, context);
        if (result) return result;
    }

    return null;
}

module.exports = {
    buildWidgetAiContext,
    executeWidgetAiTool,
    hasWidgetAiConfig,
};
