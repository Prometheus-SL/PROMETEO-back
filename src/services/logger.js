const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function formatMessage(level, context, message, meta) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
    };
    if (context) entry.context = context;
    if (meta && Object.keys(meta).length > 0) entry.meta = meta;
    return JSON.stringify(entry);
}

function createLogger(context) {
    return {
        error(message, meta) {
            if (currentLevel >= LOG_LEVELS.error) {
                console.error(formatMessage('error', context, message, meta));
            }
        },
        warn(message, meta) {
            if (currentLevel >= LOG_LEVELS.warn) {
                console.warn(formatMessage('warn', context, message, meta));
            }
        },
        info(message, meta) {
            if (currentLevel >= LOG_LEVELS.info) {
                console.log(formatMessage('info', context, message, meta));
            }
        },
        debug(message, meta) {
            if (currentLevel >= LOG_LEVELS.debug) {
                console.log(formatMessage('debug', context, message, meta));
            }
        },
        child(subContext) {
            return createLogger(context ? `${context}:${subContext}` : subContext);
        },
    };
}

module.exports = { createLogger };
