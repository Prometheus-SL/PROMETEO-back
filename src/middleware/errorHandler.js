const { buildErrorPayload } = require('../http/responses');
const { createHttpError, ensureHttpError } = require('../http/errors');

function buildErrorMeta(req, error) {
    return {
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method,
        ...(process.env.NODE_ENV === 'development' && error?.stack ? { stack: error.stack } : {}),
    };
}

const errorHandler = (err, req, res, _next) => {
    console.error('Error captured:', err);

    if (err?.headers && typeof err.headers === 'object') {
        for (const [key, value] of Object.entries(err.headers)) {
            if (value !== undefined && value !== null) {
                res.setHeader(key, String(value));
            }
        }
    }

    if (err?.code === 11000) {
        const duplicateError = createHttpError(409, 'DUPLICATE_RESOURCE', 'Resource already exists', {
            details: err.keyValue,
        });

        return res.status(duplicateError.status).json(buildErrorPayload(duplicateError, {
            meta: buildErrorMeta(req, duplicateError),
        }));
    }

    if (err?.name === 'ValidationError') {
        const details = Object.values(err.errors || {}).map((item) => item.message);
        const validationError = createHttpError(400, 'VALIDATION_ERROR', 'Validation error', {
            details: details.length > 0 ? details : err.message,
        });

        return res.status(validationError.status).json(buildErrorPayload(validationError, {
            meta: buildErrorMeta(req, validationError),
        }));
    }

    if (err?.type === 'entity.parse.failed') {
        const parseError = createHttpError(400, 'INVALID_JSON', 'Invalid JSON body', {
            details: 'The request body could not be parsed as valid JSON.',
        });

        return res.status(parseError.status).json(buildErrorPayload(parseError, {
            meta: buildErrorMeta(req, parseError),
        }));
    }

    const finalError = ensureHttpError(err, {
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
    });

    return res.status(finalError.status).json(buildErrorPayload(finalError, {
        meta: buildErrorMeta(req, finalError),
    }));
};

const notFoundHandler = (req, res) => {
    const error = createHttpError(404, 'ROUTE_NOT_FOUND', 'Route not found');

    return res.status(error.status).json(buildErrorPayload(error, {
        meta: buildErrorMeta(req, error),
    }));
};

const customLogger = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
    });

    next();
};

module.exports = {
    errorHandler,
    notFoundHandler,
    customLogger,
};
