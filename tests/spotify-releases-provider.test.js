const assert = require('node:assert/strict');
const test = require('node:test');

test('spotifyReleasesProvider', async (t) => {
    const { createSpotifyTokenProvider, createSpotifyReleasesProvider } = require('../src/services/discord/providers/spotifyReleases');

    await t.test('searchArtists should return normalized artists', async () => {
        const mockFetch = async (url, options) => {
            if (url.includes('/search')) {
                return {
                    ok: true,
                    json: async () => ({
                        artists: {
                            items: [
                                {
                                    id: 'artist1',
                                    name: 'Test Artist',
                                    images: [{ url: 'https://example.com/image.jpg' }],
                                    genres: ['rock'],
                                },
                            ],
                        },
                    }),
                };
            }
            if (url.includes('/token')) {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
                };
            }
            return { ok: false };
        };

        const tokenProvider = createSpotifyTokenProvider({
            fetch: mockFetch,
            clientId: 'test',
            clientSecret: 'test',
        });
        const provider = createSpotifyReleasesProvider({ fetch: mockFetch, tokenProvider });

        const results = await provider.searchArtists('test', { limit: 10 });
        assert.equal(results.length, 1);
        assert.equal(results[0].id, 'artist1');
        assert.equal(results[0].name, 'Test Artist');
        assert.equal(results[0].imageUrl, 'https://example.com/image.jpg');
    });

    await t.test('fetchLatestReleases should return normalized releases', async () => {
        const mockFetch = async (url) => {
            if (url.includes('/albums')) {
                return {
                    ok: true,
                    json: async () => ({
                        items: [
                            {
                                id: 'release1',
                                name: 'Test Album',
                                album_type: 'album',
                                release_date: '2026-04-19',
                                images: [{ url: 'https://example.com/album.jpg' }],
                                external_urls: { spotify: 'https://spotify.com/album/1' },
                                artists: [{ id: 'artist1' }],
                            },
                        ],
                    }),
                };
            }
            if (url.includes('/token')) {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
                };
            }
            return { ok: false };
        };

        const tokenProvider = createSpotifyTokenProvider({
            fetch: mockFetch,
            clientId: 'test',
            clientSecret: 'test',
        });
        const provider = createSpotifyReleasesProvider({ fetch: mockFetch, tokenProvider });

        const results = await provider.fetchLatestReleases('artist1', {
            limit: 10,
            includeGroups: ['album'],
        });
        assert.equal(results.length, 1);
        assert.equal(results[0].id, 'release1');
        assert.equal(results[0].type, 'album');
    });
});
