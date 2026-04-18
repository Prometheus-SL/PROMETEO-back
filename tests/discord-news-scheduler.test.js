const test = require('node:test');
const assert = require('node:assert/strict');

function makeMessenger() {
    const sends = [];
    return {
        async sendFreeGames(channelId, games) {
            sends.push({ channelId, ids: games.map((g) => g.id) });
        },
        sends,
    };
}

function makeChannelStore(initial = {}) {
    const state = new Map(
        Object.entries(initial).map(([channelId, ids]) => [channelId, new Set(ids)]),
    );
    return {
        async getKnownIds(channelId) {
            return new Set(state.get(channelId) ?? []);
        },
        async recordSent(channelId, _source, ids) {
            state.set(channelId, new Set(ids));
        },
        _dump(channelId) {
            return Array.from(state.get(channelId) ?? []).sort();
        },
    };
}

function makeConfig(overrides = {}) {
    return {
        guildId: overrides.guildId ?? 'guild-1',
        epic: {
            enabled: true,
            channelId: 'channel-1',
            lastNotifiedIds: [],
            lastNotifiedAt: null,
            lastError: null,
            ...(overrides.epic ?? {}),
        },
    };
}

const g = (id) => ({
    id,
    title: `Game ${id}`,
    description: '',
    priceOriginal: '9,99 €',
    freeUntil: new Date('2026-04-16T15:00:00.000Z'),
    imageUrl: 'https://cdn.example/x.jpg',
    storeUrl: `https://store.epicgames.com/es-ES/p/${id}`,
});

test('tickGuildConfig sends only games whose ids are not in lastNotifiedIds', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();

    const config = makeConfig({ epic: { lastNotifiedIds: ['A', 'B'] } });
    const games = [g('A'), g('C')];

    const result = await tickGuildConfig(config, games, messenger);

    assert.equal(messenger.sends.length, 1);
    assert.deepEqual(messenger.sends[0].ids, ['C']);
    assert.deepEqual(result.nextIds.sort(), ['A', 'C']);
    assert.equal(result.error, null);
});

test('tickGuildConfig sends nothing when ids are identical', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();

    const config = makeConfig({ epic: { lastNotifiedIds: ['A', 'B'] } });
    const games = [g('A'), g('B')];

    const result = await tickGuildConfig(config, games, messenger);

    assert.equal(messenger.sends.length, 0);
    assert.deepEqual(result.nextIds.sort(), ['A', 'B']);
    assert.equal(result.error, null);
});

test('tickGuildConfig returns error and keeps lastNotifiedIds unchanged on messenger failure', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = {
        async sendFreeGames() { throw new Error('channel deleted'); },
    };

    const config = makeConfig({ epic: { lastNotifiedIds: ['A'] } });
    const games = [g('A'), g('B')];

    const result = await tickGuildConfig(config, games, messenger);

    assert.equal(result.error?.message, 'channel deleted');
    assert.deepEqual(result.nextIds, ['A'], 'ids must not advance on failure');
});

test('tickGuildConfig skips configs with enabled=false', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();

    const config = makeConfig({ epic: { enabled: false, lastNotifiedIds: ['A'] } });
    const games = [g('A'), g('B')];

    const result = await tickGuildConfig(config, games, messenger);

    assert.equal(messenger.sends.length, 0);
    assert.equal(result.skipped, true);
});

test('tickGuildConfig skips configs with missing channelId', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();

    const config = makeConfig({ epic: { channelId: null, lastNotifiedIds: [] } });
    const games = [g('A')];

    const result = await tickGuildConfig(config, games, messenger);

    assert.equal(messenger.sends.length, 0);
    assert.equal(result.skipped, true);
});

test('tickGuildConfig does not resend games already posted to the same channel', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();
    const store = makeChannelStore({ 'channel-1': ['A', 'B'] });

    const config = makeConfig({ epic: { lastNotifiedIds: [] } });
    const games = [g('A'), g('B')];

    const result = await tickGuildConfig(config, games, messenger, store);

    assert.equal(messenger.sends.length, 0, 'no debería reenviar nada');
    assert.deepEqual(result.nextIds.sort(), ['A', 'B'], 'la config queda sincronizada');
    assert.equal(result.error, null);
});

test('tickGuildConfig only sends games not yet in the channel state', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();
    const store = makeChannelStore({ 'channel-1': ['A'] });

    const config = makeConfig({ epic: { lastNotifiedIds: [] } });
    const games = [g('A'), g('B')];

    const result = await tickGuildConfig(config, games, messenger, store);

    assert.equal(messenger.sends.length, 1);
    assert.deepEqual(messenger.sends[0].ids, ['B'], 'solo B es nuevo para el canal');
    assert.deepEqual(store._dump('channel-1'), ['A', 'B']);
    assert.deepEqual(result.nextIds.sort(), ['A', 'B']);
});

test('tickGuildConfig records channel state after a successful send', async () => {
    const { tickGuildConfig } = require('../src/services/discord/newsScheduler');
    const messenger = makeMessenger();
    const store = makeChannelStore();

    const config = makeConfig({ epic: { lastNotifiedIds: [] } });
    const games = [g('X'), g('Y')];

    await tickGuildConfig(config, games, messenger, store);

    assert.deepEqual(store._dump('channel-1'), ['X', 'Y']);
});
