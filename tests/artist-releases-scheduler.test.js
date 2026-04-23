const assert = require('node:assert/strict');
const test = require('node:test');

test('artistReleasesScheduler', async (t) => {
    const { tickGuildArtistReleases } = require('../src/services/discord/artistReleasesScheduler');
    const { createNoopChannelStateStore } = require('../src/services/discord/channelStateStore');

    await t.test('skips disabled configs', async () => {
        const config = {
            guildId: 'guild1',
            artistReleases: {
                enabled: false,
                subscriptions: [],
            },
        };

        const messenger = {
            sendArtistReleases: async () => {
                throw new Error('should not call messenger for disabled config');
            },
        };

        const result = await tickGuildArtistReleases(config, new Map(), messenger);
        assert.equal(result.skipped, true);
    });

    await t.test('sends new releases', async () => {
        const config = {
            guildId: 'guild1',
            artistReleases: {
                enabled: true,
                channelId: 'channel1',
                subscriptions: [
                    {
                        artistId: 'artist1',
                        name: 'Test Artist',
                        lastNotifiedIds: [],
                    },
                ],
            },
        };

        const releases = [
            { id: 'release1', name: 'New Album', type: 'album', imageUrl: 'url' },
        ];

        const releasesByKey = new Map([['artistReleases:artist1', releases]]);

        let messengerCalled = false;
        const messenger = {
            sendArtistReleases: async (channelId, data) => {
                messengerCalled = true;
                assert.equal(channelId, 'channel1');
                assert.equal(data.artistName, 'Test Artist');
            },
        };

        const result = await tickGuildArtistReleases(config, releasesByKey, messenger, createNoopChannelStateStore());
        assert.equal(result.skipped, false);
        assert.equal(messengerCalled, true);
    });

    await t.test('filters already notified releases', async () => {
        const config = {
            guildId: 'guild1',
            artistReleases: {
                enabled: true,
                channelId: 'channel1',
                subscriptions: [
                    {
                        artistId: 'artist1',
                        name: 'Test Artist',
                        lastNotifiedIds: ['release1'], // Already notified
                    },
                ],
            },
        };

        const releases = [
            { id: 'release1', name: 'Old Album', type: 'album', imageUrl: 'url' },
        ];

        const releasesByKey = new Map([['artistReleases:artist1', releases]]);

        let messengerCalled = false;
        const messenger = {
            sendArtistReleases: async () => {
                messengerCalled = true;
            },
        };

        const result = await tickGuildArtistReleases(config, releasesByKey, messenger, createNoopChannelStateStore());
        assert.equal(messengerCalled, false); // Should not send already notified
    });
});
