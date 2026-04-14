const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3001'];

function parseOrigins(value) {
    if (!value) {
        return [...DEFAULT_ALLOWED_ORIGINS];
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function getCorsSettings() {
    return {
        allowedOrigins: parseOrigins(process.env.CORS_ORIGINS || process.env.CLIENT_URL),
        allowCredentials: String(process.env.CORS_CREDENTIALS).toLowerCase() === 'true',
    };
}

function isOriginAllowed(origin, allowedOrigins) {
    if (!origin) {
        return true;
    }

    if (allowedOrigins.includes(origin)) {
        return true;
    }

    return allowedOrigins.some((value) => {
        if (!value.startsWith('/') || !value.endsWith('/')) {
            return false;
        }

        try {
            return new RegExp(value.slice(1, -1)).test(origin);
        } catch (_error) {
            return false;
        }
    });
}

function createExpressCorsOptions() {
    const { allowedOrigins, allowCredentials } = getCorsSettings();

    return {
        origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowedOrigins)),
        credentials: allowCredentials,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        optionsSuccessStatus: 204,
        preflightContinue: false,
    };
}

function createSocketCorsOptions() {
    const { allowedOrigins, allowCredentials } = getCorsSettings();

    return {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin, allowedOrigins)) {
                return callback(null, true);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },
        credentials: allowCredentials,
        methods: ['GET', 'POST'],
    };
}

module.exports = {
    createExpressCorsOptions,
    createSocketCorsOptions,
    getCorsSettings,
    isOriginAllowed,
    parseOrigins,
};
