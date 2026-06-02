const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const User = require('../src/models/User');
const { buildOAuthCallbackUrl, isDesktopLoopbackOrigin } = require('../src/services/oauthLogin');
const { createRouteApp } = require('./helpers/routeApp');

test('isDesktopLoopbackOrigin treats only loopback IPs as desktop (HERMES), not localhost web', () => {
    // HERMES desktop → larga duración
    assert.equal(isDesktopLoopbackOrigin('http://127.0.0.1:46389'), true);
    assert.equal(isDesktopLoopbackOrigin('http://[::1]:46389'), true);

    // Web (dev en localhost, prod en dominio) → caduca normal
    assert.equal(isDesktopLoopbackOrigin('http://localhost:5173'), false);
    assert.equal(isDesktopLoopbackOrigin('https://prometeo.miguelprez.es'), false);

    // Entradas inválidas → false
    assert.equal(isDesktopLoopbackOrigin(''), false);
    assert.equal(isDesktopLoopbackOrigin(null), false);
    assert.equal(isDesktopLoopbackOrigin('not-a-url'), false);
});

test('OAuth callback puts tokens in the URL fragment, not query params', () => {
    const url = new URL(buildOAuthCallbackUrl({
        origin: 'http://client.test',
        status: 'success',
        tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            sessionId: 'session-1',
        },
    }));

    assert.equal(url.searchParams.get('accessToken'), null);
    assert.equal(url.searchParams.get('refreshToken'), null);
    assert.equal(url.searchParams.get('sessionId'), null);

    const fragment = new URLSearchParams(url.hash.slice(1));
    assert.equal(fragment.get('status'), 'success');
    assert.equal(fragment.get('accessToken'), 'access-token');
    assert.equal(fragment.get('refreshToken'), 'refresh-token');
    assert.equal(fragment.get('sessionId'), 'session-1');
});

test('OAuth callback echoes clientState in the fragment only when provided', () => {
    const withState = new URL(buildOAuthCallbackUrl({
        origin: 'http://127.0.0.1:46389',
        status: 'success',
        tokens: { accessToken: 'a', refreshToken: 'r', sessionId: 's' },
        clientState: 'nonce-123',
    }));
    assert.equal(
        new URLSearchParams(withState.hash.slice(1)).get('clientState'),
        'nonce-123',
    );

    const withoutState = new URL(buildOAuthCallbackUrl({
        origin: 'http://127.0.0.1:46389',
        status: 'success',
        tokens: { accessToken: 'a', refreshToken: 'r', sessionId: 's' },
    }));
    assert.equal(
        new URLSearchParams(withoutState.hash.slice(1)).get('clientState'),
        null,
    );
});

test('password is required for password users but optional for OAuth users', () => {
    const passwordUser = new User({
        username: 'passworduser',
        email: 'passworduser@example.com',
    });
    const passwordError = passwordUser.validateSync();
    assert.equal(passwordError?.errors?.password?.kind, 'required');

    const oauthUser = new User({
        username: 'oauthuser',
        email: 'oauthuser@example.com',
        oauthProviders: [{
            provider: 'google',
            providerId: 'google-1',
            email: 'oauthuser@example.com',
        }],
    });
    const oauthError = oauthUser.validateSync();
    assert.equal(oauthError?.errors?.password, undefined);
});

function createOAuthLoginRouteApp(options = {}) {
    const createdLoginHistoryEntries = options.createdLoginHistoryEntries || [];

    return createRouteApp({
        routePath: 'src/routes/oauthLogin.js',
        mountPath: '/auth/oauth',
        mocks: {
            'src/models/LoginHistory.js': {
                create: async (entry) => {
                    createdLoginHistoryEntries.push(entry);
                    return entry;
                },
            },
            'src/services/oauthLogin.js': {
                assertValidProvider: () => {},
                buildOAuthCallbackUrl: ({ origin, status }) => `${origin}/oauth/callback#status=${status}`,
                buildOAuthLoginUrl: () => 'https://provider.test/oauth',
                completeOAuthLogin: async () => ({
                    user: {
                        _id: '507f1f77bcf86cd799439011',
                        username: 'mike',
                    },
                    tokens: {
                        accessToken: 'access-token',
                        refreshToken: 'refresh-token',
                        sessionId: 'session-1',
                    },
                }),
                verifyOAuthLoginState: () => ({
                    returnOrigin: 'http://client.test',
                }),
            },
        },
    });
}

test('OAuth callback records provider logins with normalized oauth metadata', async (t) => {
    const createdLoginHistoryEntries = [];
    const { app, cleanup } = createOAuthLoginRouteApp({ createdLoginHistoryEntries });
    t.after(cleanup);

    const response = await request(app)
        .get('/auth/oauth/google/callback')
        .query({ code: 'oauth-code', state: 'signed-state' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, 'http://client.test/oauth/callback#status=success');
    assert.equal(createdLoginHistoryEntries.length, 1);
    assert.equal(createdLoginHistoryEntries[0].method, 'oauth');
    assert.equal(createdLoginHistoryEntries[0].provider, 'google');
    assert.equal(createdLoginHistoryEntries[0].success, true);
    assert.equal(createdLoginHistoryEntries[0].sessionId, 'session-1');
});
