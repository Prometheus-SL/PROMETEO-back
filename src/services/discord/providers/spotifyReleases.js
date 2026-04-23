function createSpotifyTokenProvider({ fetch: customFetch, clientId, clientSecret, logger = console }) {
    const fetchFn = customFetch || fetch;
    let cachedToken = null;
    let tokenExpiry = null;
    let tokenPromise = null;

    async function refreshToken() {
        const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await fetchFn('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${encoded}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Spotify authentication failed: invalid credentials');
            }
            throw new Error(`Token refresh failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        cachedToken = data.access_token;
        const expiresInSeconds = data.expires_in || 3600;
        tokenExpiry = Date.now() + expiresInSeconds * 1000;

        return cachedToken;
    }

    return {
        async getToken() {
            const now = Date.now();
            const refreshThreshold = 30 * 1000; // Refresh 30s before expiry

            if (cachedToken && tokenExpiry && now < tokenExpiry - refreshThreshold) {
                return cachedToken;
            }

            if (tokenPromise) {
                return tokenPromise;
            }

            tokenPromise = refreshToken();
            try {
                return await tokenPromise;
            } finally {
                tokenPromise = null;
            }
        },
    };
}

function createSpotifyReleasesProvider({ fetch: customFetch, tokenProvider, logger = console }) {
    const fetchFn = customFetch || fetch;

    async function request(url, options = {}) {
        const token = await tokenProvider.getToken();
        const response = await fetchFn(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                ...options.headers,
            },
        });

        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));

            const retryResponse = await fetchFn(url, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    ...options.headers,
                },
            });

            if (retryResponse.status === 429) {
                throw new Error('Spotify rate limit exceeded');
            }

            return retryResponse;
        }

        if (response.status === 401) {
            throw new Error('Spotify authentication failed: invalid token');
        }

        if (!response.ok && response.status >= 500) {
            throw new Error(`Spotify API error: HTTP ${response.status}`);
        }

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`Spotify API error: HTTP ${response.status}`);
        }

        return response.json();
    }

    return {
        async getArtistById(id) {
            if (!id || typeof id !== 'string') {
                return null;
            }

            const data = await request(`https://api.spotify.com/v1/artists/${id}`);
            if (!data || !data.id) {
                return null;
            }

            return {
                id: data.id,
                name: data.name,
                imageUrl: data.images && data.images.length > 0 ? data.images[0].url : null,
                genres: data.genres || [],
            };
        },

        async searchArtists(query, { limit = 10 } = {}) {
            const params = new URLSearchParams({
                type: 'artist',
                q: query,
                limit: Math.min(limit, 50),
            });

            const data = await request(`https://api.spotify.com/v1/search?${params}`);
            if (!data || !data.artists) {
                return [];
            }

            return data.artists.items
                .filter((artist) => artist.images && artist.images.length > 0)
                .map((artist) => ({
                    id: artist.id,
                    name: artist.name,
                    imageUrl: artist.images[0].url,
                    genres: artist.genres || [],
                }));
        },

        async fetchLatestReleases(artistId, { limit = 10, includeGroups = ['album', 'single'] } = {}) {
            const params = new URLSearchParams({
                include_groups: includeGroups.join(','),
                limit: Math.min(limit, 50),
            });

            const data = await request(
                `https://api.spotify.com/v1/artists/${artistId}/albums?${params}`,
            );

            if (!data || !data.items) {
                return [];
            }

            return data.items.map((release) => ({
                id: release.id,
                name: release.name,
                type: release.album_type,
                releaseDate: release.release_date,
                imageUrl: release.images && release.images.length > 0 ? release.images[0].url : null,
                url: release.external_urls?.spotify || '',
                artistIds: (release.artists || []).map((a) => a.id),
            }));
        },
    };
}

module.exports = { createSpotifyTokenProvider, createSpotifyReleasesProvider };
