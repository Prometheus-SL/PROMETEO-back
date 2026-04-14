function buildSuccessPayload(data, options = {}) {
    const payload = {
        success: true,
        data: data === undefined ? null : data,
    };

    if (options.message) {
        payload.message = options.message;
    }

    if (options.meta !== undefined) {
        payload.meta = options.meta;
    }

    return payload;
}

function buildErrorPayload(error, options = {}) {
    const payload = {
        success: false,
        error: {
            code: error.code,
            message: error.message,
        },
    };

    if (error.details !== undefined) {
        payload.error.details = error.details;
    }

    if (options.meta !== undefined) {
        payload.meta = options.meta;
    }

    return payload;
}

function ok(res, data, options = {}) {
    return res.status(options.status || 200).json(buildSuccessPayload(data, options));
}

function created(res, data, options = {}) {
    return res.status(201).json(buildSuccessPayload(data, options));
}

function noContent(res) {
    return res.status(204).send();
}

module.exports = {
    buildSuccessPayload,
    buildErrorPayload,
    ok,
    created,
    noContent,
};
