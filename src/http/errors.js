const DEFAULT_ERROR_MESSAGES = {
    400: 'Bad request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not found',
    409: 'Conflict',
    422: 'Unprocessable entity',
    429: 'Too many requests',
    500: 'Internal server error',
    503: 'Service unavailable',
};

class HttpError extends Error {
    constructor(status, code, message, options = {}) {
        super(message || DEFAULT_ERROR_MESSAGES[status] || DEFAULT_ERROR_MESSAGES[500]);
        this.name = 'HttpError';
        this.status = status || 500;
        this.code = code || 'INTERNAL_SERVER_ERROR';
        this.details = options.details;
        this.headers = options.headers;
        this.expose = options.expose !== undefined ? options.expose : this.status < 500;
    }
}

function createHttpError(status, code, message, options) {
    return new HttpError(status, code, message, options);
}

function ensureHttpError(error, fallback = {}) {
    if (error instanceof HttpError) {
        return error;
    }

    if (error && typeof error === 'object' && error.status && error.message) {
        return createHttpError(
            Number(error.status) || fallback.status || 500,
            error.code || fallback.code || 'INTERNAL_SERVER_ERROR',
            error.message || fallback.message,
            {
                details: error.details,
                headers: error.headers,
                expose: error.expose,
            }
        );
    }

    return createHttpError(
        fallback.status || 500,
        fallback.code || 'INTERNAL_SERVER_ERROR',
        fallback.message || DEFAULT_ERROR_MESSAGES[fallback.status || 500],
        { details: fallback.details, headers: fallback.headers }
    );
}

module.exports = {
    HttpError,
    createHttpError,
    ensureHttpError,
};
