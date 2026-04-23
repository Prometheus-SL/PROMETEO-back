const MISS = Symbol('cache-miss');

class LRUCache {
    constructor({ max = 500 } = {}) {
        this.max = max;
        this.cache = new Map();
        this.ttlMap = new Map();
    }

    set(key, value, ttlMs) {
        if (this.cache.size >= this.max && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            this.ttlMap.delete(firstKey);
        }

        this.cache.delete(key);
        this.cache.set(key, value);

        if (ttlMs) {
            const expiry = Date.now() + ttlMs;
            this.ttlMap.set(key, expiry);
        }
    }

    get(key) {
        if (!this.cache.has(key)) {
            return MISS;
        }

        const expiry = this.ttlMap.get(key);
        if (expiry && Date.now() > expiry) {
            this.cache.delete(key);
            this.ttlMap.delete(key);
            return MISS;
        }

        return this.cache.get(key);
    }

    has(key) {
        return this.get(key) !== MISS;
    }

    clear() {
        this.cache.clear();
        this.ttlMap.clear();
    }
}

LRUCache.MISS = MISS;

function createSpotifyArtistCatalog({
    provider,
    searchTtlMs = 5 * 60 * 1000,
    artistTtlMs = 24 * 60 * 60 * 1000,
    max = 500,
} = {}) {
    const cache = new LRUCache({ max });

    function normalizeQuery(q) {
        return q.trim().toLowerCase();
    }

    return {
        async search(query, { limit = 10 } = {}) {
            const normalized = normalizeQuery(query);

            if (normalized.length < 2) {
                return [];
            }

            const cacheKey = `search:${normalized}`;
            const cached = cache.get(cacheKey);
            if (cached !== LRUCache.MISS) {
                return cached.slice(0, limit);
            }

            const results = await provider.searchArtists(query, { limit });
            const mapped = results.map((r) => ({
                id: r.id,
                name: r.name,
                imageUrl: r.imageUrl,
            }));

            cache.set(cacheKey, mapped, searchTtlMs);
            return mapped.slice(0, limit);
        },

        async getArtist(id) {
            const cacheKey = `artist:${id}`;
            const cached = cache.get(cacheKey);
            if (cached !== LRUCache.MISS) {
                return cached;
            }

            try {
                const artist = await provider.getArtistById(id);

                if (!artist) {
                    cache.set(cacheKey, null, artistTtlMs);
                    return null;
                }

                const mapped = {
                    id: artist.id,
                    name: artist.name,
                    imageUrl: artist.imageUrl,
                };

                cache.set(cacheKey, mapped, artistTtlMs);
                return mapped;
            } catch (err) {
                if (err.message && err.message.includes('404')) {
                    cache.set(cacheKey, null, artistTtlMs);
                    return null;
                }
                throw err;
            }
        },

        clear() {
            cache.clear();
        },
    };
}

module.exports = { createSpotifyArtistCatalog };
