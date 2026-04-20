const assert = require('node:assert/strict');
const test = require('node:test');

const User = require('../src/models/User');
const { buildOAuthCallbackUrl } = require('../src/services/oauthLogin');

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
