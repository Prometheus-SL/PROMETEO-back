const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

function readTimeoutMs(value, fallback = DEFAULT_FETCH_TIMEOUT_MS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

function createTimeoutError(label, timeoutMs) {
    const error = new Error(`${label} timed out after ${timeoutMs}ms`);
    error.name = 'AbortError';
    error.code = 'FETCH_TIMEOUT';
    return error;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, label = 'Request') {
    const normalizedTimeout = readTimeoutMs(timeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutError = createTimeoutError(label, normalizedTimeout);
    const timeoutId = setTimeout(() => {
        controller.abort(timeoutError);
    }, normalizedTimeout);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } catch (error) {
        if (error === timeoutError || (controller.signal.aborted && error?.name === 'AbortError')) {
            throw timeoutError;
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

module.exports = {
    fetchWithTimeout,
    readTimeoutMs,
};
