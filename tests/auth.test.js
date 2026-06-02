const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function createMockUser(overrides = {}) {
    return {
        _id: '507f1f77bcf86cd799439011',
        username: 'mike',
        email: 'mike@example.com',
        role: 'user',
        isActive: true,
        lastLogin: null,
        name: 'Mike',
        surname: 'Stone',
        birthday: null,
        registerSession() {},
        removeSessionByRefreshToken() {},
        save: async () => {},
        matchPassword: async () => true,
        ...overrides,
    };
}

function createAuthRouteApp(options = {}) {
    const loginUser = options.loginUser || createMockUser();
    const refreshUser = options.refreshUser || loginUser;
    const loginHistoryEntries = options.loginHistoryEntries || [];
    const createdLoginHistoryEntries = options.createdLoginHistoryEntries || [];
    const loginHistoryQueries = options.loginHistoryQueries || [];

    const mocks = {
        'src/models/User.js': {
            findOne(query) {
                if (query?.$or) {
                    return {
                        select: async () => loginUser,
                    };
                }

                return null;
            },
        },
        'src/models/LoginHistory.js': {
            create: async (entry) => {
                createdLoginHistoryEntries.push(entry);
                return entry;
            },
            find(query) {
                loginHistoryQueries.push(query);
                return {
                    sort() {
                        return {
                            limit() {
                                return {
                                    skip() {
                                        return {
                                            lean: async () => loginHistoryEntries,
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            },
            countDocuments: async () => loginHistoryEntries.length,
        },
        'src/services/totp.js': {
            generateSecret: () => 'JBSWY3DPEHPK3PXP',
            verifyTOTP: (_secret, token) => token === '123456',
            buildOtpauthUri: (secret, username) => `otpauth://totp/PROMETEO:${username}?secret=${secret}`,
            generateRecoveryCodes: () => ['ABCDEF12'],
        },
        'src/models/Agent.js': {
            findOne: async () => null,
        },
        'src/models/QRCode.js': {
            findOne: async () => null,
        },
        'src/middleware/auth.js': {
            authenticateToken(req, _res, next) {
                req.user = refreshUser;
                req.auth = { sessionId: 'session-1' };
                next();
            },
            authorizeRole() {
                return (_req, _res, next) => next();
            },
            generateTokens(_user, tokenOptions = {}) {
                return {
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    sessionId: tokenOptions.sessionId || 'session-1',
                    expiresIn: null,
                };
            },
            verifyRefreshToken(req, _res, next) {
                req.user = refreshUser;
                req.refreshToken = req.body.refreshToken;
                req.auth = { sessionId: 'session-1' };
                next();
            },
        },
    };

    return createRouteApp({
        routePath: 'src/routes/auth.js',
        mountPath: '/auth',
        mocks,
    });
}

test('POST /auth/login returns a normalized validation error when fields are missing', async (t) => {
    const { app, cleanup } = createAuthRouteApp();
    t.after(cleanup);

    const response = await request(app).post('/auth/login').send({});

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'LOGIN_FIELDS_REQUIRED');
    assert.equal(response.body.error.message, 'Username or email and password are required');
    assert.equal(response.body.meta.path, '/auth/login');
  });

test('POST /auth/login returns the success envelope with user and tokens', async (t) => {
    let registeredSession = null;
    let saveCalled = false;

    const loginUser = createMockUser({
        matchPassword: async (password) => password === 'secret',
        registerSession(session) {
            registeredSession = session;
        },
        async save() {
            saveCalled = true;
        },
    });

    const { app, cleanup } = createAuthRouteApp({ loginUser });
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/login')
        .send({ username: 'mike', password: 'secret' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.user.username, 'mike');
    assert.equal(response.body.data.tokens.accessToken, 'access-token');
    assert.equal(response.body.data.tokens.refreshToken, 'refresh-token');
    assert.equal(response.body.data.tokens.sessionId, 'session-1');
    assert.equal(saveCalled, true);
    assert.equal(registeredSession.sessionId, 'session-1');
    assert.equal(registeredSession.refreshToken, 'refresh-token');
});

test('POST /auth/login requires a second factor before issuing tokens', async (t) => {
    let saveCalled = false;
    let registeredSession = null;

    const loginUser = createMockUser({
        twoFactor: {
            enabled: true,
            secret: 'JBSWY3DPEHPK3PXP',
            recoveryCodes: [],
        },
        registerSession(session) {
            registeredSession = session;
        },
        async save() {
            saveCalled = true;
        },
    });

    const { app, cleanup } = createAuthRouteApp({ loginUser });
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/login')
        .send({ username: 'mike', password: 'secret' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.twoFactorRequired, true);
    assert.equal(response.body.data.tokens, undefined);
    assert.equal(saveCalled, false);
    assert.equal(registeredSession, null);
});

test('POST /auth/login accepts a valid second factor and issues tokens', async (t) => {
    let registeredSession = null;

    const loginUser = createMockUser({
        twoFactor: {
            enabled: true,
            secret: 'JBSWY3DPEHPK3PXP',
            recoveryCodes: [],
        },
        registerSession(session) {
            registeredSession = session;
        },
    });

    const { app, cleanup } = createAuthRouteApp({ loginUser });
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/login')
        .send({ username: 'mike', password: 'secret', totpToken: '123456' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.twoFactorRequired, undefined);
    assert.equal(response.body.data.tokens.accessToken, 'access-token');
    assert.equal(registeredSession.sessionId, 'session-1');
});

test('POST /auth/login records a failed password attempt for a known user', async (t) => {
    const createdLoginHistoryEntries = [];
    const loginUser = createMockUser({
        matchPassword: async () => false,
    });

    const { app, cleanup } = createAuthRouteApp({
        loginUser,
        createdLoginHistoryEntries,
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/login')
        .send({ username: 'mike', password: 'wrong-password' });

    assert.equal(response.status, 401);
    assert.equal(createdLoginHistoryEntries.length, 1);
    assert.equal(createdLoginHistoryEntries[0].userId, loginUser._id);
    assert.equal(createdLoginHistoryEntries[0].username, loginUser.username);
    assert.equal(createdLoginHistoryEntries[0].method, 'password');
    assert.equal(createdLoginHistoryEntries[0].success, false);
    assert.equal(createdLoginHistoryEntries[0].failureReason, 'INVALID_CREDENTIALS');
    assert.equal(createdLoginHistoryEntries[0].identifier, 'mike');
});

test('POST /auth/refresh returns the refreshed token envelope', async (t) => {
    let removedToken = null;
    let registeredSession = null;

    const refreshUser = createMockUser({
        removeSessionByRefreshToken(token) {
            removedToken = token;
        },
        registerSession(session) {
            registeredSession = session;
        },
    });

    const { app, cleanup } = createAuthRouteApp({ refreshUser });
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'stale-refresh-token' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.accessToken, 'access-token');
    assert.equal(response.body.data.refreshToken, 'refresh-token');
    assert.equal(removedToken, 'stale-refresh-token');
    assert.equal(registeredSession.sessionId, 'session-1');
});

test('POST /auth/login sets the refresh token as an HttpOnly cookie', async (t) => {
    const loginUser = createMockUser({ matchPassword: async (password) => password === 'secret' });
    const { app, cleanup } = createAuthRouteApp({ loginUser });
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/login')
        .send({ username: 'mike', password: 'secret' });

    assert.equal(response.status, 200);
    const cookies = response.headers['set-cookie'] || [];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('prometeo_rt='));
    assert.ok(refreshCookie, 'should set the prometeo_rt cookie');
    assert.match(refreshCookie, /HttpOnly/i);
    assert.match(refreshCookie, /Path=\/auth/i);
});

test('POST /auth/refresh accepts the refresh token from the cookie when the body is empty', async (t) => {
    const { app, cleanup } = createAuthRouteApp();
    t.after(cleanup);

    const response = await request(app)
        .post('/auth/refresh')
        .set('Cookie', 'prometeo_rt=cookie-refresh-token')
        .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.accessToken, 'access-token');
});

test('GET /auth/login-history returns history and entries aliases', async (t) => {
    const loginHistoryEntries = [
        {
            _id: 'history-1',
            method: 'password',
            success: true,
            createdAt: '2026-04-20T10:00:00.000Z',
        },
    ];

    const { app, cleanup } = createAuthRouteApp({ loginHistoryEntries });
    t.after(cleanup);

    const response = await request(app).get('/auth/login-history');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.history, loginHistoryEntries);
    assert.deepEqual(response.body.data.entries, loginHistoryEntries);
});

test('GET /auth/login-history scopes entries to the retained 30-day window', async (t) => {
    const loginHistoryQueries = [];
    const now = Date.now();
    const { app, cleanup } = createAuthRouteApp({ loginHistoryQueries });
    t.after(cleanup);

    const response = await request(app).get('/auth/login-history');

    assert.equal(response.status, 200);
    assert.equal(loginHistoryQueries.length, 1);
    assert.equal(loginHistoryQueries[0].userId, '507f1f77bcf86cd799439011');
    assert.ok(loginHistoryQueries[0].createdAt?.$gte instanceof Date);

    const cutoffAgeMs = now - loginHistoryQueries[0].createdAt.$gte.getTime();
    const twentyNineDaysMs = 29 * 24 * 60 * 60 * 1000;
    const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
    assert.ok(cutoffAgeMs >= twentyNineDaysMs);
    assert.ok(cutoffAgeMs <= thirtyOneDaysMs);
});
