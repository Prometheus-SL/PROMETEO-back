const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'src', 'services', 'discord', 'client.js');

function resetClient() {
    delete require.cache[require.resolve(clientPath)];
}

function installFakeDiscordJs(client) {
    mock('discord.js', {
        Client: class FakeClient { constructor() {} on() {} login() {} },
        GatewayIntentBits: {},
        PermissionsBitField: {
            Flags: { Administrator: 8n },
        },
    });
    // Stub user and model dependencies used by client.js requires
    mock(path.join(__dirname, '..', 'src', 'models', 'User.js'), {});
    mock(
        path.join(__dirname, '..', 'src', 'services', 'discord', 'providers', 'epicFreeGames.js'),
        { createEpicFreeGamesProvider: () => ({}) },
    );
    mock(
        path.join(__dirname, '..', 'src', 'services', 'discord', 'newsMessenger.js'),
        { createDiscordNewsMessenger: () => ({}) },
    );
    mock(
        path.join(__dirname, '..', 'src', 'services', 'discord', 'newsScheduler.js'),
        { createDiscordNewsScheduler: () => ({ start() {} }) },
    );
    mock(
        path.join(__dirname, '..', 'src', 'services', 'discord', 'channelStateStore.js'),
        { createChannelStateStore: () => ({}) },
    );

    resetClient();
    const mod = require(clientPath);
    mod.__setClientForTests(client);
    return mod;
}

function makeGuild({ ownerId = 'owner-1', members = {}, found = true } = {}) {
    const cache = new Map();
    if (found) {
        cache.set('guild-1', {
            id: 'guild-1',
            ownerId,
            async fetch() { return this; },
            members: {
                async fetch({ user }) {
                    if (!members[user]) {
                        throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                    }
                    return members[user];
                },
            },
        });
    }
    return {
        guilds: {
            cache: {
                get(id) { return cache.get(id); },
            },
        },
    };
}

test('getMemberPermissions: no linked discord account', async (t) => {
    const fakeClient = makeGuild();
    const { getMemberPermissions } = installFakeDiscordJs(fakeClient);
    t.after(() => { mock.stopAll(); resetClient(); });

    const result = await getMemberPermissions('guild-1', null);
    assert.deepEqual(result, { isAdmin: false, isOwner: false, hasLinkedDiscord: false });
});

test('getMemberPermissions: guild not found throws 404', async (t) => {
    const fakeClient = makeGuild({ found: false });
    const { getMemberPermissions } = installFakeDiscordJs(fakeClient);
    t.after(() => { mock.stopAll(); resetClient(); });

    await assert.rejects(
        () => getMemberPermissions('guild-1', 'user-1'),
        (err) => err.status === 404,
    );
});

test('getMemberPermissions: member is owner', async (t) => {
    const fakeClient = makeGuild({
        ownerId: 'user-1',
        members: {
            'user-1': {
                id: 'user-1',
                permissions: { has: () => false },
            },
        },
    });
    const { getMemberPermissions } = installFakeDiscordJs(fakeClient);
    t.after(() => { mock.stopAll(); resetClient(); });

    const result = await getMemberPermissions('guild-1', 'user-1');
    assert.deepEqual(result, { isAdmin: false, isOwner: true, hasLinkedDiscord: true });
});

test('getMemberPermissions: member has Administrator flag', async (t) => {
    const fakeClient = makeGuild({
        members: {
            'user-2': {
                id: 'user-2',
                permissions: { has: (flag) => flag === 8n },
            },
        },
    });
    const { getMemberPermissions } = installFakeDiscordJs(fakeClient);
    t.after(() => { mock.stopAll(); resetClient(); });

    const result = await getMemberPermissions('guild-1', 'user-2');
    assert.deepEqual(result, { isAdmin: true, isOwner: false, hasLinkedDiscord: true });
});

test('getMemberPermissions: regular member', async (t) => {
    const fakeClient = makeGuild({
        members: {
            'user-3': {
                id: 'user-3',
                permissions: { has: () => false },
            },
        },
    });
    const { getMemberPermissions } = installFakeDiscordJs(fakeClient);
    t.after(() => { mock.stopAll(); resetClient(); });

    const result = await getMemberPermissions('guild-1', 'user-3');
    assert.deepEqual(result, { isAdmin: false, isOwner: false, hasLinkedDiscord: true });
});

test('getMemberPermissions: user not in guild resolves to false flags', async (t) => {
    const fakeClient = makeGuild({ members: {} });
    const { getMemberPermissions } = installFakeDiscordJs(fakeClient);
    t.after(() => { mock.stopAll(); resetClient(); });

    const result = await getMemberPermissions('guild-1', 'ghost');
    assert.deepEqual(result, { isAdmin: false, isOwner: false, hasLinkedDiscord: true });
});
