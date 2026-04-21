const test = require('node:test');
const assert = require('node:assert/strict');

function makeFakeChannel() {
    const calls = [];
    return {
        id: 'channel-123',
        type: 0, // GuildText
        async send(payload) {
            calls.push(payload);
            return { id: 'sent-message-id' };
        },
        calls,
    };
}

function makeFakeClient(channel) {
    return {
        channels: {
            async fetch(id) {
                if (id === channel.id) return channel;
                return null;
            },
        },
    };
}

function sampleGame(overrides = {}) {
    return {
        id: 'offer-1',
        title: 'Prop Sumo',
        description: 'Fun prop battles.',
        priceOriginal: '9,99 €',
        freeUntil: new Date('2026-04-16T15:00:00.000Z'),
        imageUrl: 'https://cdn.example/wide.jpg',
        storeUrl: 'https://store.epicgames.com/es-ES/p/prop-sumo',
        ...overrides,
    };
}

test('sendFreeGames sends one embed per game with a Link button per game', async () => {
    const { createDiscordNewsMessenger } = require('../src/services/discord/newsMessenger');
    const channel = makeFakeChannel();
    const client = makeFakeClient(channel);

    const messenger = createDiscordNewsMessenger({ client });
    await messenger.sendFreeGames('channel-123', [sampleGame(), sampleGame({ id: 'offer-2', title: 'Second Free Game' })]);

    assert.equal(channel.calls.length, 1, 'one message with two embeds');
    const payload = channel.calls[0];
    assert.equal(payload.embeds.length, 2);
    assert.equal(payload.embeds[0].data.title, 'Prop Sumo');
    assert.equal(payload.embeds[1].data.title, 'Second Free Game');

    const components = payload.components ?? [];
    assert.equal(components.length, 1, 'one action row');
    const row = components[0].toJSON ? components[0].toJSON() : components[0];
    assert.equal(row.components.length, 2, 'one button per game');
    assert.ok(row.components[0].url.includes('prop-sumo'));
});

test('sendFreeGames throws when channel is not a text channel', async () => {
    const { createDiscordNewsMessenger } = require('../src/services/discord/newsMessenger');
    const channel = { id: 'channel-voice', type: 2, async send() {} };
    const client = makeFakeClient(channel);

    const messenger = createDiscordNewsMessenger({ client });
    await assert.rejects(
        () => messenger.sendFreeGames('channel-voice', [sampleGame()]),
        /not a text channel/i,
    );
});

test('sendFreeGames is a no-op for empty input', async () => {
    const { createDiscordNewsMessenger } = require('../src/services/discord/newsMessenger');
    const channel = makeFakeChannel();
    const client = makeFakeClient(channel);

    const messenger = createDiscordNewsMessenger({ client });
    await messenger.sendFreeGames('channel-123', []);
    assert.equal(channel.calls.length, 0);
});

function sampleSteamItem(overrides = {}) {
    return {
        gid: '1830163047267453',
        title: 'Counter-Strike 2 Update',
        url: 'https://steam/news/1830163047267453',
        contents: '[p]\\[ MISC ][/p][list][*][p]Fixed a bug that removed the delay between burst fire bullets.[/p][/*][/list]',
        date: new Date('2026-04-21T03:11:28.000Z'),
        feedname: 'steam_community_announcements',
        ...overrides,
    };
}

test('sendGameUpdates renders embeds using thumbnail (small image), not full image', async () => {
    const { createDiscordNewsMessenger } = require('../src/services/discord/newsMessenger');
    const channel = makeFakeChannel();
    const client = makeFakeClient(channel);

    const messenger = createDiscordNewsMessenger({ client });
    await messenger.sendGameUpdates('channel-123', {
        appId: 730,
        appName: 'Counter-Strike 2',
        items: [sampleSteamItem()],
    });

    assert.equal(channel.calls.length, 1);
    const embed = channel.calls[0].embeds[0].data;
    assert.ok(embed.thumbnail?.url?.includes('/730/'), 'uses thumbnail with appId 730');
    assert.equal(embed.image, undefined, 'does not set full-size image');
});

test('sendGameUpdates description contains markdown-converted BBCode (bold headers, bullets)', async () => {
    const { createDiscordNewsMessenger } = require('../src/services/discord/newsMessenger');
    const channel = makeFakeChannel();
    const client = makeFakeClient(channel);

    const messenger = createDiscordNewsMessenger({ client });
    await messenger.sendGameUpdates('channel-123', {
        appId: 730,
        appName: 'Counter-Strike 2',
        items: [sampleSteamItem()],
    });

    const embed = channel.calls[0].embeds[0].data;
    assert.ok(embed.description.includes('**Misc**'), 'section header rendered as bold markdown');
    assert.ok(embed.description.includes('• Fixed a bug that removed the delay'), 'list item rendered as bullet');
    assert.ok(!embed.description.includes('\\['), 'no residual escaped brackets');
    assert.ok(!embed.description.includes('[p]'), 'no residual bbcode tags');
});

test('sendGameUpdates is a no-op for empty items', async () => {
    const { createDiscordNewsMessenger } = require('../src/services/discord/newsMessenger');
    const channel = makeFakeChannel();
    const client = makeFakeClient(channel);

    const messenger = createDiscordNewsMessenger({ client });
    await messenger.sendGameUpdates('channel-123', { appId: 730, appName: 'X', items: [] });
    assert.equal(channel.calls.length, 0);
});
