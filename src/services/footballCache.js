function createCache({ now = () => Date.now() } = {}) {
    const entries = new Map();
    const inflight = new Map();

    function fetch(key, ttlMs, loader) {
        const cached = entries.get(key);
        if (cached && cached.expiresAt > now()) {
            return Promise.resolve(cached.value);
        }

        const pending = inflight.get(key);
        if (pending) {
            return pending;
        }

        const promise = (async () => {
            try {
                const value = await loader();
                entries.set(key, { value, expiresAt: now() + ttlMs });
                return value;
            } finally {
                inflight.delete(key);
            }
        })();

        inflight.set(key, promise);
        return promise;
    }

    function peek(key) {
        const cached = entries.get(key);
        if (!cached) return undefined;
        if (cached.expiresAt <= now()) return undefined;
        return cached.value;
    }

    function clear() {
        entries.clear();
        inflight.clear();
    }

    return { fetch, peek, clear };
}

module.exports = { createCache };
