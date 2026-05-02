const DashboardPage = require('../../models/DashboardPage');
const {
    buildWidgetAiContext,
    executeWidgetAiTool,
} = require('../ai/widgetRegistry');

function dedupeTargets(targets) {
    const byKey = new Map();

    for (const target of targets) {
        if (!target?.provider || !target?.safeKey) continue;
        const key = `${target.provider}:${target.safeKey}`;
        if (!byKey.has(key)) {
            byKey.set(key, target);
        }
    }

    return Array.from(byKey.values());
}

function getBuiltInTools() {
    return [
        {
            type: 'function',
            function: {
                name: 'spark_get_time',
                description: 'Get the current local time for simple time questions.',
                parameters: { type: 'object', properties: {} },
            },
        },
        {
            type: 'function',
            function: {
                name: 'spark_get_date',
                description: 'Get the current date in Spanish.',
                parameters: { type: 'object', properties: {} },
            },
        },
        {
            type: 'function',
            function: {
                name: 'spark_list_tools',
                description: 'List the dashboard tools Spark can currently use.',
                parameters: { type: 'object', properties: {} },
            },
        },
    ];
}

async function buildSparkToolContext(user) {
    const pages = await DashboardPage.find({ user: user._id }).lean();
    const widgetContext = buildWidgetAiContext({ user, pages });
    const targets = dedupeTargets(widgetContext.targets);
    const tools = mergeTools([
        getBuiltInTools(),
        widgetContext.tools,
    ]);
    const summary = dedupeSummary(widgetContext.summary);

    return {
        user,
        targets,
        tools,
        summary,
    };
}

function mergeTools(toolGroups) {
    const toolMap = new Map();

    for (const tools of toolGroups) {
        for (const tool of tools || []) {
            if (!toolMap.has(tool.function.name)) {
                toolMap.set(tool.function.name, tool);
            }
        }
    }

    return Array.from(toolMap.values());
}

function dedupeSummary(items) {
    const byKey = new Map();

    for (const item of items || []) {
        if (!item?.provider || !item?.safeKey) continue;
        const key = `${item.provider}:${item.safeKey}`;
        if (!byKey.has(key)) {
            byKey.set(key, item);
        }
    }

    return Array.from(byKey.values());
}

function getCurrentTimeMessage() {
    const now = new Date();
    return `Son las ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}.`;
}

function getCurrentDateMessage() {
    const date = new Date().toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return `Hoy es ${date}.`;
}

async function executeSparkTool(call, context) {
    const name = call?.name;

    if (name === 'spark_get_time') {
        const message = getCurrentTimeMessage();
        return { success: true, message, clientActions: [], data: { message } };
    }

    if (name === 'spark_get_date') {
        const message = getCurrentDateMessage();
        return { success: true, message, clientActions: [], data: { message } };
    }

    if (name === 'spark_list_tools') {
        const names = context.summary.map((item) => `${item.provider}: ${item.name}`);
        const message = names.length > 0
            ? `Puedo controlar: ${names.join(', ')}.`
            : 'Aun no hay herramientas de modulos configuradas.';

        return { success: true, message, clientActions: [], data: { tools: context.summary } };
    }

    const widgetAiResult = await executeWidgetAiTool(call, context);
    if (widgetAiResult) {
        return widgetAiResult;
    }

    return {
        success: false,
        message: `La herramienta ${name || 'desconocida'} no esta disponible.`,
        clientActions: [],
    };
}

module.exports = {
    buildSparkToolContext,
    collectModuleTargets: async (user) => {
        const pages = await DashboardPage.find({ user: user._id }).lean();
        return dedupeTargets(buildWidgetAiContext({ user, pages }).targets);
    },
    executeSparkTool,
};
