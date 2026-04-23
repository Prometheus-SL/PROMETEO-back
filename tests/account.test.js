const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const sharp = require('sharp');

const { createRouteApp } = require('./helpers/routeApp');

function createMutationRouteApp({ user, modelUser = user, findOne = async () => null } = {}) {
    return createRouteApp({
        routePath: 'src/routes/account.js',
        mountPath: '/api/v1/account',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = user;
                    req.auth = { sessionId: 'session-1' };
                    next();
                },
            },
            'src/models/User.js': {
                findById: () => ({
                    select: async () => modelUser,
                    then: (resolve, reject) => Promise.resolve(modelUser).then(resolve, reject),
                }),
                findOne,
            },
            'src/services/spotifyIntegration.js': {
                buildSpotifyAuthorizeUrl: () => '',
                completeSpotifyLink: async () => null,
                disconnectSpotifyAccount: async () => null,
            },
            'src/services/discordIntegration.js': {
                buildDiscordAuthorizeUrl: () => '',
                completeDiscordLink: async () => null,
                disconnectDiscordAccount: async () => null,
            },
            'src/services/googleIntegration.js': {
                buildGoogleAuthorizeUrl: () => '',
                completeGoogleLink: async () => null,
                disconnectGoogleAccount: async () => null,
            },
            'src/services/githubIntegration.js': {
                buildGithubAuthorizeUrl: () => '',
                completeGithubLink: async () => null,
                disconnectGithubAccount: async () => null,
            },
            'src/services/creatorIntegration.js': {
                getCreatorStatus: async () => ({
                    status: 'disconnected',
                    profile: null,
                    connectedAt: null,
                    scopes: [],
                    lastError: null,
                }),
            },
        },
    });
}

test('GET /api/v1/account returns the normalized account payload', async (t) => {
    const user = {
        _id: 'user-1',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        lastLogin: null,
        name: 'Mike',
        surname: 'Stone',
        birthday: null,
        linkedAccounts: {
            spotify: {
                status: 'connected',
                profile: {
                    displayName: 'Mike on Spotify',
                },
                scopes: ['user-read-private'],
                connectedAt: '2026-04-14T12:00:00.000Z',
            },
            discord: {
                status: 'disconnected',
                profile: {},
                scopes: [],
                connectedAt: null,
            },
        },
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/account.js',
        mountPath: '/api/v1/account',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = user;
                    req.auth = { sessionId: 'session-1' };
                    next();
                },
            },
            'src/models/User.js': {
                findById: async () => null,
            },
            'src/services/spotifyIntegration.js': {
                buildSpotifyAuthorizeUrl: () => '',
                completeSpotifyLink: async () => null,
                disconnectSpotifyAccount: async () => null,
            },
            'src/services/discordIntegration.js': {
                buildDiscordAuthorizeUrl: () => '',
                completeDiscordLink: async () => null,
                disconnectDiscordAccount: async () => null,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/account/');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.user.username, 'mike');
    assert.equal(response.body.data.linkedAccounts.spotify.status, 'connected');
    assert.equal(response.body.data.linkedAccounts.discord.status, 'disconnected');
});

test('GET /api/v1/account/providers returns the provider registry with live statuses', async (t) => {
    const user = {
        _id: 'user-1',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {
            spotify: {
                status: 'connected',
                profile: {
                    displayName: 'Mike on Spotify',
                },
                scopes: ['user-read-private'],
                connectedAt: '2026-04-14T12:00:00.000Z',
            },
            discord: {
                status: 'disconnected',
                profile: {},
                scopes: [],
                connectedAt: null,
            },
        },
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/account.js',
        mountPath: '/api/v1/account',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = user;
                    req.auth = { sessionId: 'session-1' };
                    next();
                },
            },
            'src/models/User.js': {
                findById: async () => null,
            },
            'src/services/spotifyIntegration.js': {
                buildSpotifyAuthorizeUrl: () => '',
                completeSpotifyLink: async () => null,
                disconnectSpotifyAccount: async () => null,
                getSpotifyStatus: async () => ({
                    status: 'connected',
                    displayName: 'Mike on Spotify',
                    avatarUrl: null,
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: ['user-read-private'],
                    lastError: null,
                    product: 'premium',
                    externalUrl: null,
                }),
            },
            'src/services/discordIntegration.js': {
                buildDiscordAuthorizeUrl: () => '',
                completeDiscordLink: async () => null,
                disconnectDiscordAccount: async () => null,
                getDiscordStatus: async () => ({
                    status: 'disconnected',
                    id: null,
                    displayName: null,
                    username: null,
                    avatarUrl: null,
                    connectedAt: null,
                    scopes: [],
                    lastError: null,
                    email: null,
                    verified: null,
                }),
            },
            'src/services/googleIntegration.js': {
                buildGoogleAuthorizeUrl: () => '',
                completeGoogleLink: async () => null,
                disconnectGoogleAccount: async () => null,
                getGoogleStatus: async () => ({
                    status: 'connected',
                    profile: {
                        email: 'mike@gmail.com',
                        displayName: 'Mike Workspace',
                    },
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: ['calendar.readonly', 'gmail.readonly'],
                    lastError: null,
                }),
            },
            'src/services/githubIntegration.js': {
                buildGithubAuthorizeUrl: () => '',
                completeGithubLink: async () => null,
                disconnectGithubAccount: async () => null,
                getGithubStatus: async () => ({
                    status: 'connected',
                    profile: {
                        login: 'mike',
                        displayName: 'Mike on GitHub',
                    },
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: ['notifications', 'repo'],
                    lastError: null,
                }),
            },
            'src/services/creatorIntegration.js': {
                getCreatorStatus: async () => ({
                    status: 'connected',
                    profile: {
                        displayName: 'Prometeo Creator',
                    },
                    connectedAt: '2026-04-14T12:00:00.000Z',
                    scopes: [],
                    lastError: null,
                }),
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/account/providers');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.providers.length, 5);
    assert.equal(response.body.data.providers[0].id, 'spotify');
    assert.equal(response.body.data.providers[0].status, 'connected');
    assert.equal(response.body.data.providers[1].id, 'discord');
    assert.equal(response.body.data.providers[2].id, 'google');
    assert.equal(response.body.data.providers[3].id, 'github');
    assert.equal(response.body.data.providers[4].id, 'creator');
    assert.equal(response.body.data.providers[4].connectSupported, false);
});

test('PATCH /api/v1/account/profile updates editable profile fields', async (t) => {
    let saveCalled = false;
    const user = {
        _id: 'user-1',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        name: 'Mike',
        surname: 'Stone',
        birthday: null,
        linkedAccounts: {},
        save: async () => {
            saveCalled = true;
        },
    };
    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const response = await request(app)
        .patch('/api/v1/account/profile')
        .send({
            username: 'miguel',
            name: 'Miguel',
            surname: 'Perez',
        });

    assert.equal(response.status, 200);
    assert.equal(saveCalled, true);
    assert.equal(user.username, 'miguel');
    assert.equal(user.name, 'Miguel');
    assert.equal(user.surname, 'Perez');
    assert.equal(response.body.data.user.username, 'miguel');
});

test('POST /api/v1/account/password changes password after current password check', async (t) => {
    let saveCalled = false;
    const user = {
        _id: 'user-1',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {},
        matchPassword: async (password) => password === 'current-password-123',
        save: async () => {
            saveCalled = true;
        },
    };
    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/account/password')
        .send({
            currentPassword: 'current-password-123',
            newPassword: 'new-strong-password-123',
        });

    assert.equal(response.status, 200);
    assert.equal(saveCalled, true);
    assert.equal(user.password, 'new-strong-password-123');
});

async function makeJpegBuffer() {
    return sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 200, b: 40 } },
    }).jpeg().toBuffer();
}

test('POST /api/v1/account/avatar stores the processed avatar and updates the user', async (t) => {
    let saveCalled = false;

    const user = {
        _id: 'user-123',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {},
        avatarUrl: null,
        avatarUpdatedAt: null,
        save: async () => { saveCalled = true; },
    };

    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    process.env.AVATARS_DIR_OVERRIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'));

    t.after(() => {
        fs.rmSync(process.env.AVATARS_DIR_OVERRIDE, { recursive: true, force: true });
        delete process.env.AVATARS_DIR_OVERRIDE;
    });

    const buf = await makeJpegBuffer();
    const response = await request(app)
        .post('/api/v1/account/avatar')
        .attach('file', buf, { filename: 'me.jpg', contentType: 'image/jpeg' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.user.avatarUrl, '/uploads/avatars/user-123.webp');
    assert.ok(response.body.data.user.avatarUpdatedAt);
    assert.equal(user.avatarUrl, '/uploads/avatars/user-123.webp');
    assert.ok(user.avatarUpdatedAt instanceof Date);
    assert.equal(saveCalled, true);
    assert.ok(fs.existsSync(path.join(process.env.AVATARS_DIR_OVERRIDE, 'user-123.webp')));
});

test('POST /api/v1/account/avatar rejects a non-image upload with AVATAR_TYPE_INVALID', async (t) => {
    const user = {
        _id: 'user-123',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {},
        avatarUrl: null,
        avatarUpdatedAt: null,
        save: async () => {},
    };

    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/account/avatar')
        .attach('file', Buffer.from('not an image'), { filename: 'me.txt', contentType: 'image/jpeg' });

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'AVATAR_TYPE_INVALID');
});

test('POST /api/v1/account/avatar rejects a missing file with AVATAR_FILE_REQUIRED', async (t) => {
    const user = {
        _id: 'user-123',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {},
        avatarUrl: null,
        avatarUpdatedAt: null,
        save: async () => {},
    };

    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/account/avatar');

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'AVATAR_FILE_REQUIRED');
});

test('DELETE /api/v1/account/avatar clears the avatar fields and deletes the file', async (t) => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'));
    process.env.AVATARS_DIR_OVERRIDE = tmp;
    const existingFile = path.join(tmp, 'user-456.webp');
    fs.writeFileSync(existingFile, Buffer.from([0x52, 0x49, 0x46, 0x46])); // dummy bytes

    t.after(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.AVATARS_DIR_OVERRIDE;
    });

    let saveCalled = false;
    const user = {
        _id: 'user-456',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {},
        avatarUrl: '/uploads/avatars/user-456.webp',
        avatarUpdatedAt: new Date('2026-04-20T12:00:00Z'),
        save: async () => { saveCalled = true; },
    };

    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const response = await request(app).delete('/api/v1/account/avatar');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.user.avatarUrl, null);
    assert.equal(response.body.data.user.avatarUpdatedAt, null);
    assert.equal(user.avatarUrl, null);
    assert.equal(user.avatarUpdatedAt, null);
    assert.equal(saveCalled, true);
    assert.equal(fs.existsSync(existingFile), false);
});

test('DELETE /api/v1/account/avatar is idempotent when the file is missing', async (t) => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'));
    process.env.AVATARS_DIR_OVERRIDE = tmp;

    t.after(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.AVATARS_DIR_OVERRIDE;
    });

    const user = {
        _id: 'user-789',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        linkedAccounts: {},
        avatarUrl: null,
        avatarUpdatedAt: null,
        save: async () => {},
    };

    const { app, cleanup } = createMutationRouteApp({ user });
    t.after(cleanup);

    const response = await request(app).delete('/api/v1/account/avatar');

    assert.equal(response.status, 200);
    assert.equal(response.body.data.user.avatarUrl, null);
});
