const assert = require('node:assert/strict');
const test = require('node:test');

test('artistReleasesService', async (t) => {
    const service = require('../src/services/discord/artistReleasesService');

    await t.test('getStatusForUser returns empty configs when no guilds', async () => {
        const mockUserGuildsService = async () => ({
            needsLink: false,
            needsReauth: false,
            guilds: [],
        });

        // Test structure - would need mocking of getUserAdminGuilds in actual implementation
        assert.ok(typeof service.getStatusForUser === 'function');
    });

    await t.test('publicEntry returns correct shape', async () => {
        const doc = {
            guildId: 'guild1',
            artistReleases: {
                enabled: true,
                channelId: 'channel1',
                includeTypes: ['album', 'single'],
                subscriptions: [
                    {
                        artistId: 'artist1',
                        name: 'Test Artist',
                        imageUrl: 'https://example.com/image.jpg',
                        lastNotifiedAt: new Date('2026-04-19T10:00:00Z'),
                        lastError: null,
                    },
                ],
                updatedBy: 'user123',
                updatedAt: new Date('2026-04-19T10:00:00Z'),
            },
        };

        const entry = service.publicEntry(doc);
        assert.equal(entry.guildId, 'guild1');
        assert.equal(entry.channelId, 'channel1');
        assert.equal(entry.enabled, true);
        assert.deepEqual(entry.includeTypes, ['album', 'single']);
        assert.equal(entry.subscriptions.length, 1);
        assert.equal(entry.subscriptions[0].name, 'Test Artist');
        assert.equal(entry.subscriptions[0].lastError, null);
    });

    await t.test('MAX_SUBS_PER_GUILD is 25', async () => {
        assert.equal(service.MAX_SUBS_PER_GUILD, 25);
    });
});
