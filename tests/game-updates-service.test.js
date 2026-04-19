const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const path = require('path');

const servicePath = path.resolve(__dirname, '..', 'src/services/discord/gameUpdatesService.js');

function makeModel(initialDocs = []) {
    const store = new Map(initialDocs.map((d) => [d.guildId, JSON.parse(JSON.stringify(d))]));
    const Model = {
        find(query) {
            const ids = query?.guildId?.$in ?? null;
            const out = [];
            for (const doc of store.values()) {
                if (!ids || ids.includes(doc.guildId)) out.push(doc);
            }
            return {
                lean: async () => out.map((d) => JSON.parse(JSON.stringify(d))),
            };
        },
        async findOne(query) {
            const doc = store.get(query.guildId);
            return doc ? JSON.parse(JSON.stringify(doc)) : null;
        },
        async findOneAndUpdate(query, update) {
            const existing = store.get(query.guildId) ?? { guildId: query.guildId };
            const next = { ...existing, ...update };
            store.set(query.guildId, JSON.parse(JSON.stringify(next)));
            return JSON.parse(JSON.stringify(next));
        },
        _dump() {
            return Array.from(store.values()).map((d) => JSON.parse(JSON.stringify(d)));
        },
    };
    return Model;
}

function fakeBotWithChannels(channelsByGuild) {
    return {
        guilds: {
            cache: {
                get(guildId) {
                    if (!(guildId in channelsByGuild)) return null;
                    return {
                        channels: {
                            cache: {
                                get(channelId) {
                                    const ch = channelsByGuild[guildId][channelId];
                                    return ch ? { ...ch } : null;
                                },
                            },
                        },
                    };
                },
            },
        },
    };
}

function setupMocks({
    adminGuilds = [],
    needsLink = false,
    needsReauth = false,
    channelsByGuild = { 'g1': { 'c1': { type: 0 } } },
    catalog = { 730: 'Counter-Strike 2', 570: 'Dota 2' },
    newsItemsByAppId = {},
} = {}) {
    mock(path.resolve(__dirname, '..', 'src/services/discord/userGuildsService.js'), {
        async getUserAdminGuilds() {
            return { needsLink, needsReauth, guilds: adminGuilds };
        },
    });
    mock(path.resolve(__dirname, '..', 'src/services/discord/client.js'), {
        getClient() { return fakeBotWithChannels(channelsByGuild); },
    });
    mock(path.resolve(__dirname, '..', 'src/services/discord/steamCatalog.js'), {
        createSteamCatalog() { return {}; },
        getSharedCatalog() {
            return {
                async getName(appId) { return catalog[appId] ?? null; },
            };
        },
    });
    mock(path.resolve(__dirname, '..', 'src/services/discord/providers/steamNews.js'), {
        createSteamNewsProvider() {
            return {
                async fetchLatestUpdates(appId) { return newsItemsByAppId[appId] ?? []; },
            };
        },
    });
    delete require.cache[servicePath];
}

test.afterEach(() => { mock.stopAll(); delete require.cache[servicePath]; });

test('getStatusForUser returns needsLink when discord is unlinked', async () => {
    setupMocks({ needsLink: true });
    const svc = require(servicePath);
    const Model = makeModel();
    const out = await svc.getStatusForUser('u1', { Model });
    assert.deepEqual(out, { configs: [], needsLink: true, needsReauth: false });
});

test('getStatusForUser returns only configs for user admin/owner guilds', async () => {
    setupMocks({
        adminGuilds: [{ id: 'g1' }, { id: 'g2' }],
    });
    const svc = require(servicePath);
    const Model = makeModel([
        { guildId: 'g1', gameUpdates: { enabled: true, channelId: 'c1', subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: ['x'], lastNotifiedAt: null, lastError: null }] } },
        { guildId: 'g2', gameUpdates: { enabled: false, channelId: null, subscriptions: [] } },
        { guildId: 'g3-other', gameUpdates: { enabled: true, channelId: 'c9', subscriptions: [] } },
    ]);
    const out = await svc.getStatusForUser('u1', { Model });
    const ids = out.configs.map((c) => c.guildId).sort();
    assert.deepEqual(ids, ['g1', 'g2']);
    const g1 = out.configs.find((c) => c.guildId === 'g1');
    assert.equal(g1.enabled, true);
    assert.equal(g1.subscriptions.length, 1);
    assert.equal(g1.subscriptions[0].appId, 730);
    assert.equal(g1.subscriptions[0].name, 'CS2');
    assert.equal('lastNotifiedGids' in g1.subscriptions[0], false, 'lastNotifiedGids must not leak to clients');
});

test('saveStatusForUser rejects guildId outside user admin/owner set with 403', async () => {
    setupMocks({ adminGuilds: [{ id: 'g1' }] });
    const svc = require(servicePath);
    const Model = makeModel();

    await assert.rejects(
        () => svc.saveStatusForUser('u1', [{ guildId: 'g-other', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }] }], { Model }),
        (err) => err.status === 403,
    );
});

test('saveStatusForUser rejects enabled=true without channelId with 400', async () => {
    setupMocks({ adminGuilds: [{ id: 'g1' }] });
    const svc = require(servicePath);
    const Model = makeModel();

    await assert.rejects(
        () => svc.saveStatusForUser('u1', [{ guildId: 'g1', channelId: null, enabled: true, subscriptions: [{ appId: 730 }] }], { Model }),
        (err) => err.status === 400,
    );
});

test('saveStatusForUser rejects more than 25 subscriptions with 400', async () => {
    setupMocks({ adminGuilds: [{ id: 'g1' }], catalog: Object.fromEntries(Array.from({ length: 30 }, (_v, i) => [i + 1, `Game ${i + 1}`])) });
    const svc = require(servicePath);
    const Model = makeModel();
    const subs = Array.from({ length: 26 }, (_v, i) => ({ appId: i + 1 }));

    await assert.rejects(
        () => svc.saveStatusForUser('u1', [{ guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: subs }], { Model }),
        (err) => err.status === 400 && /25/.test(err.message),
    );
});

test('saveStatusForUser rejects appId not in catalog with 400', async () => {
    setupMocks({ adminGuilds: [{ id: 'g1' }], catalog: { 730: 'Counter-Strike 2' } });
    const svc = require(servicePath);
    const Model = makeModel();

    await assert.rejects(
        () => svc.saveStatusForUser('u1', [{ guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 999999 }] }], { Model }),
        (err) => err.status === 400 && /999999/.test(err.message),
    );
});

test('saveStatusForUser deduplicates appIds within the same guild silently', async () => {
    setupMocks({
        adminGuilds: [{ id: 'g1' }],
        newsItemsByAppId: { 730: [{ gid: 'g1', title: 't', url: 'u', contents: '', date: new Date(), feedname: 'steam_updates' }] },
    });
    const svc = require(servicePath);
    const Model = makeModel();

    const result = await svc.saveStatusForUser('u1', [
        { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }, { appId: 730 }, { appId: 570 }] },
    ], { Model });

    const doc = Model._dump().find((d) => d.guildId === 'g1');
    const ids = doc.gameUpdates.subscriptions.map((s) => s.appId).sort();
    assert.deepEqual(ids, [570, 730]);
    assert.equal(result.warning, null);
});

test('saveStatusForUser seeds lastNotifiedGids for new subscriptions with current gids', async () => {
    setupMocks({
        adminGuilds: [{ id: 'g1' }],
        newsItemsByAppId: {
            730: [
                { gid: 'gid-a', title: 't', url: 'u', contents: '', date: new Date(), feedname: 'steam_updates' },
                { gid: 'gid-b', title: 't', url: 'u', contents: '', date: new Date(), feedname: 'patchnotes' },
            ],
        },
    });
    const svc = require(servicePath);
    const Model = makeModel();

    await svc.saveStatusForUser('u1', [
        { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }] },
    ], { Model });

    const doc = Model._dump().find((d) => d.guildId === 'g1');
    const sub = doc.gameUpdates.subscriptions.find((s) => s.appId === 730);
    assert.deepEqual(sub.lastNotifiedGids.sort(), ['gid-a', 'gid-b']);
    assert.ok(sub.lastNotifiedAt, 'lastNotifiedAt must be set');
});

test('saveStatusForUser preserves lastNotifiedGids for unchanged subscriptions', async () => {
    setupMocks({ adminGuilds: [{ id: 'g1' }] });
    const svc = require(servicePath);
    const Model = makeModel([
        { guildId: 'g1', gameUpdates: { enabled: true, channelId: 'c1', subscriptions: [{ appId: 730, name: 'CS2', lastNotifiedGids: ['old1', 'old2'], lastNotifiedAt: new Date('2026-01-01'), lastError: null }] } },
    ]);

    await svc.saveStatusForUser('u1', [
        { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }] },
    ], { Model });

    const doc = Model._dump().find((d) => d.guildId === 'g1');
    const sub = doc.gameUpdates.subscriptions.find((s) => s.appId === 730);
    assert.deepEqual(sub.lastNotifiedGids, ['old1', 'old2']);
});

test('saveStatusForUser removes subscriptions that are no longer listed', async () => {
    setupMocks({ adminGuilds: [{ id: 'g1' }] });
    const svc = require(servicePath);
    const Model = makeModel([
        { guildId: 'g1', gameUpdates: { enabled: true, channelId: 'c1', subscriptions: [
            { appId: 730, name: 'CS2', lastNotifiedGids: [], lastNotifiedAt: null, lastError: null },
            { appId: 570, name: 'Dota 2', lastNotifiedGids: [], lastNotifiedAt: null, lastError: null },
        ] } },
    ]);

    await svc.saveStatusForUser('u1', [
        { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }] },
    ], { Model });

    const doc = Model._dump().find((d) => d.guildId === 'g1');
    const ids = doc.gameUpdates.subscriptions.map((s) => s.appId);
    assert.deepEqual(ids, [730]);
});

test('saveStatusForUser records warning when seeding fetch fails', async () => {
    mock(path.resolve(__dirname, '..', 'src/services/discord/userGuildsService.js'), {
        async getUserAdminGuilds() { return { needsLink: false, needsReauth: false, guilds: [{ id: 'g1' }] }; },
    });
    mock(path.resolve(__dirname, '..', 'src/services/discord/client.js'), {
        getClient() { return fakeBotWithChannels({ 'g1': { 'c1': { type: 0 } } }); },
    });
    mock(path.resolve(__dirname, '..', 'src/services/discord/steamCatalog.js'), {
        createSteamCatalog() { return {}; },
        getSharedCatalog() { return { async getName(id) { return id === 730 ? 'CS2' : null; } }; },
    });
    mock(path.resolve(__dirname, '..', 'src/services/discord/providers/steamNews.js'), {
        createSteamNewsProvider() {
            return { async fetchLatestUpdates() { throw new Error('upstream down'); } };
        },
    });
    delete require.cache[servicePath];
    const svc = require(servicePath);
    const Model = makeModel();

    const result = await svc.saveStatusForUser('u1', [
        { guildId: 'g1', channelId: 'c1', enabled: true, subscriptions: [{ appId: 730 }] },
    ], { Model });

    assert.ok(result.warning && /upstream down/.test(result.warning));
    const doc = Model._dump().find((d) => d.guildId === 'g1');
    const sub = doc.gameUpdates.subscriptions.find((s) => s.appId === 730);
    assert.deepEqual(sub.lastNotifiedGids, []);
});
