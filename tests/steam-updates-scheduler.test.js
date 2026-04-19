const test = require('node:test');
const assert = require('node:assert/strict');

const { tickGuildGameUpdates, MAX_GIDS_PER_SUB } = require('../src/services/discord/steamUpdatesScheduler');

function makeMessenger() {
    const sends = [];
    return {
        async sendGameUpdates(channelId, { appId, appName, items }) {
            sends.push({ channelId, appId, appName, gids: items.map((i) => i.gid) });
        },
        sends,
    };
}

function makeChannelStore(initial = {}) {
    const state = new Map(
        Object.entries(initial).map(([k, ids]) => [k, new Set(ids)]),
    );
    return {
        async getKnownIds(channelId, source) {
            return new Set(state.get(`${channelId}:${source}`) ?? []);
        },
        async recordSent(channelId, source, ids) {
            state.set(`${channelId}:${source}`, new Set(ids));
        },
        _dump(channelId, source) {
            return Array.from(state.get(`${channelId}:${source}`) ?? []).sort();
        },
    };
}

function makeConfig(overrides = {}) {
    return {
        guildId: overrides.guildId ?? 'guild-1',
        gameUpdates: {
            enabled: overrides.enabled ?? true,
            channelId: 'channelId' in overrides ? overrides.channelId : 'channel-1',
            subscriptions: overrides.subscriptions ?? [],
        },
    };
}

function item(gid) {
    return { gid, title: `Patch ${gid}`, url: `https://steam/${gid}`, contents: '', date: new Date(), feedname: 'patchnotes' };
}

test('tickGuildGameUpdates sends only items whose gids are new to the sub', async () => {
    const messenger = makeMessenger();
    const store = makeChannelStore();
    const config = makeConfig({
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: ['g1'] }],
    });
    const itemsByAppId = new Map([[730, [item('g1'), item('g2')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(messenger.sends.length, 1);
    assert.deepEqual(messenger.sends[0].gids, ['g2']);
    assert.equal(result.perSub.length, 1);
    assert.deepEqual(result.perSub[0].nextGids.sort(), ['g1', 'g2']);
    assert.equal(result.perSub[0].error, null);
});

test('tickGuildGameUpdates sends nothing when all gids are already seen by the sub', async () => {
    const messenger = makeMessenger();
    const store = makeChannelStore();
    const config = makeConfig({
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: ['g1', 'g2'] }],
    });
    const itemsByAppId = new Map([[730, [item('g1'), item('g2')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(messenger.sends.length, 0);
    assert.deepEqual(result.perSub[0].nextGids.sort(), ['g1', 'g2']);
});

test('tickGuildGameUpdates skips items already posted to the same channel via channelStateStore', async () => {
    const messenger = makeMessenger();
    const store = makeChannelStore({ 'channel-1:steamGameUpdates:730': ['g1'] });
    const config = makeConfig({
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: [] }],
    });
    const itemsByAppId = new Map([[730, [item('g1'), item('g2')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(messenger.sends.length, 1);
    assert.deepEqual(messenger.sends[0].gids, ['g2']);
    assert.deepEqual(store._dump('channel-1', 'steamGameUpdates:730'), ['g1', 'g2']);
    assert.deepEqual(result.perSub[0].nextGids.sort(), ['g1', 'g2']);
});

test('tickGuildGameUpdates returns skipped when gameUpdates.enabled is false', async () => {
    const messenger = makeMessenger();
    const store = makeChannelStore();
    const config = makeConfig({
        enabled: false,
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: [] }],
    });
    const itemsByAppId = new Map([[730, [item('g1')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(messenger.sends.length, 0);
    assert.equal(result.skipped, true);
});

test('tickGuildGameUpdates returns skipped when channelId is missing', async () => {
    const messenger = makeMessenger();
    const store = makeChannelStore();
    const config = makeConfig({
        channelId: null,
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: [] }],
    });
    const itemsByAppId = new Map([[730, [item('g1')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(messenger.sends.length, 0);
    assert.equal(result.skipped, true);
});

test('tickGuildGameUpdates records error per-sub when messenger fails; lastNotifiedGids stays unchanged', async () => {
    const messenger = {
        async sendGameUpdates() { throw new Error('channel deleted'); },
    };
    const store = makeChannelStore();
    const config = makeConfig({
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: ['g0'] }],
    });
    const itemsByAppId = new Map([[730, [item('g1')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(result.perSub.length, 1);
    assert.equal(result.perSub[0].error?.message, 'channel deleted');
    assert.deepEqual(result.perSub[0].nextGids, ['g0'], 'gids must not advance on failure');
});

test('tickGuildGameUpdates processes subs independently when one fails', async () => {
    let calls = 0;
    const messenger = {
        async sendGameUpdates(channelId, { appId }) {
            calls += 1;
            if (appId === 730) throw new Error('cs2 fail');
        },
    };
    const store = makeChannelStore();
    const config = makeConfig({
        subscriptions: [
            { appId: 730, name: 'CS2', lastNotifiedGids: [] },
            { appId: 570, name: 'Dota 2', lastNotifiedGids: [] },
        ],
    });
    const itemsByAppId = new Map([
        [730, [item('g1')]],
        [570, [item('g2')]],
    ]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(calls, 2);
    assert.equal(result.perSub[0].error?.message, 'cs2 fail');
    assert.equal(result.perSub[1].error, null);
    assert.deepEqual(result.perSub[1].nextGids, ['g2']);
});

test('tickGuildGameUpdates caps nextGids at MAX_GIDS_PER_SUB (50)', async () => {
    assert.equal(MAX_GIDS_PER_SUB, 50);
    const messenger = makeMessenger();
    const store = makeChannelStore();
    const oldGids = Array.from({ length: 48 }, (_v, i) => `old${i}`);
    const config = makeConfig({
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: oldGids }],
    });
    const itemsByAppId = new Map([[730, [item('new1'), item('new2'), item('new3')]]]);

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(result.perSub[0].nextGids.length, 50);
    assert.ok(result.perSub[0].nextGids.includes('new1'));
    assert.ok(result.perSub[0].nextGids.includes('new3'));
    assert.equal(result.perSub[0].nextGids.includes('old0'), false, 'oldest gids must be dropped');
});

test('tickGuildGameUpdates skips subs whose appId has no items (fetch failure upstream)', async () => {
    const messenger = makeMessenger();
    const store = makeChannelStore();
    const config = makeConfig({
        subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: [] }],
    });
    const itemsByAppId = new Map();

    const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, store);

    assert.equal(messenger.sends.length, 0);
    assert.equal(result.perSub.length, 1);
    assert.equal(result.perSub[0].error, null);
    assert.deepEqual(result.perSub[0].nextGids, []);
});
