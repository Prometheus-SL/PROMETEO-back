const assert = require('node:assert/strict');
const test = require('node:test');

test('spotifyArtistCatalog', async (t) => {
    const { createSpotifyArtistCatalog } = require('../src/services/discord/spotifyArtistCatalog');

    await t.test('search returns empty for short queries', async () => {
        const mockProvider = {
            searchArtists: async () => {
                throw new Error('should not call provider for short query');
            },
        };

        const catalog = createSpotifyArtistCatalog({ provider: mockProvider });
        const results = await catalog.search('a', { limit: 10 });
        assert.equal(results.length, 0);
    });

    await t.test('search caches results', async () => {
        let callCount = 0;
        const mockProvider = {
            searchArtists: async () => {
                callCount++;
                return [
                    { id: 'artist1', name: 'Test Artist', imageUrl: 'https://example.com/image.jpg' },
                ];
            },
        };

        const catalog = createSpotifyArtistCatalog({
            provider: mockProvider,
            searchTtlMs: 5000,
        });

        await catalog.search('test', { limit: 10 });
        assert.equal(callCount, 1);

        await catalog.search('test', { limit: 10 });
        assert.equal(callCount, 1); // Should be cached
    });

    await t.test('getArtist returns null for non-existent artists', async () => {
        const mockProvider = {
            getArtistById: async () => null,
        };

        const catalog = createSpotifyArtistCatalog({ provider: mockProvider });
        const result = await catalog.getArtist('nonexistent');
        assert.equal(result, null);
    });

    await t.test('getArtist caches null results', async () => {
        let callCount = 0;
        const mockProvider = {
            getArtistById: async () => {
                callCount++;
                return null;
            },
        };

        const catalog = createSpotifyArtistCatalog({ provider: mockProvider });
        await catalog.getArtist('missing');
        await catalog.getArtist('missing');
        assert.equal(callCount, 1); // Second call should hit cache
    });

    await t.test('getArtist returns cached artist', async () => {
        let callCount = 0;
        const mockProvider = {
            getArtistById: async (id) => {
                callCount++;
                return { id, name: 'Drake', imageUrl: 'url' };
            },
        };

        const catalog = createSpotifyArtistCatalog({ provider: mockProvider });
        const a = await catalog.getArtist('artist1');
        const b = await catalog.getArtist('artist1');
        assert.equal(callCount, 1);
        assert.deepEqual(a, { id: 'artist1', name: 'Drake', imageUrl: 'url' });
        assert.deepEqual(b, a);
    });
});
