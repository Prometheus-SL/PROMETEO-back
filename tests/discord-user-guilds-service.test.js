const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const path = require('path');

const servicePath = path.join(__dirname, '..', 'src', 'services', 'discord', 'userGuildsService.js');

function resetModule() {
    delete require.cache[require.resolve(servicePath)];
}

function installDeps({ user, apiGuilds = [], botGuildIds = [], accessToken = 'tok' }) {
    mock(path.join(__dirname, '..', 'src', 'models', 'User.js'), {
        findById: async (id) => {
            assert.equal(id, 'user-1');
            return user;
        },
    });
    mock(path.join(__dirname, '..', 'src', 'services', 'discord', 'client.js'), {
        getClient() {
            return { guilds: { cache: { map: (fn) => botGuildIds.map((id) => fn({ id })) } } };
        },
    });
    mock(path.join(__dirname, '..', 'src', 'services', 'discordIntegration.js'), {
        async fetchDiscordUserGuilds(tok) {
            assert.equal(tok, accessToken);
            return apiGuilds;
        },
        async getValidDiscordAccessToken() {
            return accessToken;
        },
    });
    resetModule();
    return require(servicePath);
}

function apiGuild({ id, name = 'Guild', owner = false, adminBit = false, icon = null }) {
    const permissions = adminBit ? String(0x8) : '0';
    return { id, name, icon, owner, permissions };
}

test('getUserAdminGuilds: returns needsLink when status !== connected', async (t) => {
    const { getUserAdminGuilds } = installDeps({
        user: { _id: 'user-1', linkedAccounts: { discord: { status: 'disconnected' } } },
    });
    t.after(() => { mock.stopAll(); resetModule(); });
    const result = await getUserAdminGuilds('user-1');
    assert.deepEqual(result, { needsLink: true, needsReauth: false, guilds: [] });
});

test('getUserAdminGuilds: returns needsReauth when guilds scope is missing', async (t) => {
    const { getUserAdminGuilds } = installDeps({
        user: { _id: 'user-1', linkedAccounts: { discord: { status: 'connected', scopes: ['identify'] } } },
    });
    t.after(() => { mock.stopAll(); resetModule(); });
    const result = await getUserAdminGuilds('user-1');
    assert.deepEqual(result, { needsLink: false, needsReauth: true, guilds: [] });
});

test('getUserAdminGuilds: filters to owner/admin and marks botPresent', async (t) => {
    const { getUserAdminGuilds } = installDeps({
        user: { _id: 'user-1', linkedAccounts: { discord: { status: 'connected', scopes: ['identify', 'guilds'] } } },
        apiGuilds: [
            apiGuild({ id: 'g-owner', name: 'OwnerGuild', owner: true }),
            apiGuild({ id: 'g-admin', name: 'AdminGuild', adminBit: true }),
            apiGuild({ id: 'g-member', name: 'MemberOnly' }),
        ],
        botGuildIds: ['g-admin'],
    });
    t.after(() => { mock.stopAll(); resetModule(); });

    const result = await getUserAdminGuilds('user-1');
    assert.equal(result.needsLink, false);
    assert.equal(result.needsReauth, false);
    assert.equal(result.guilds.length, 2);

    const owner = result.guilds.find((g) => g.id === 'g-owner');
    const admin = result.guilds.find((g) => g.id === 'g-admin');
    assert.equal(owner.isOwner, true);
    assert.equal(owner.botPresent, false);
    assert.equal(admin.isAdmin, true);
    assert.equal(admin.botPresent, true);
});

test('getUserAdminGuilds: builds icon URL when icon hash present', async (t) => {
    const { getUserAdminGuilds } = installDeps({
        user: { _id: 'user-1', linkedAccounts: { discord: { status: 'connected', scopes: ['guilds'] } } },
        apiGuilds: [apiGuild({ id: 'g-1', name: 'A', owner: true, icon: 'abcd1234' })],
    });
    t.after(() => { mock.stopAll(); resetModule(); });
    const result = await getUserAdminGuilds('user-1');
    assert.equal(result.guilds[0].icon, 'https://cdn.discordapp.com/icons/g-1/abcd1234.png?size=128');
});

test('getUserAdminGuilds: animated icons use gif extension', async (t) => {
    const { getUserAdminGuilds } = installDeps({
        user: { _id: 'user-1', linkedAccounts: { discord: { status: 'connected', scopes: ['guilds'] } } },
        apiGuilds: [apiGuild({ id: 'g-1', name: 'A', owner: true, icon: 'a_xyz' })],
    });
    t.after(() => { mock.stopAll(); resetModule(); });
    const result = await getUserAdminGuilds('user-1');
    assert.ok(result.guilds[0].icon.endsWith('.gif?size=128'));
});
