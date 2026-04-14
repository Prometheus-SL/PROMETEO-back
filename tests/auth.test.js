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
