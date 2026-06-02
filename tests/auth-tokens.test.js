const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const { generateTokens } = require('../src/middleware/auth');

const user = {
    _id: '507f1f77bcf86cd799439011',
    username: 'mike',
    email: 'mike@example.com',
    role: 'user',
};

test('web login tokens carry an expiry and report it', () => {
    const { accessToken, refreshToken, expiresIn } = generateTokens(user);
    const access = jwt.decode(accessToken);
    const refresh = jwt.decode(refreshToken);

    assert.equal(typeof access.exp, 'number');
    assert.equal(typeof refresh.exp, 'number');
    assert.equal(typeof expiresIn, 'number');
    assert.ok(expiresIn > 0);
});

test('kiosk login tokens never expire', () => {
    const { accessToken, refreshToken, expiresIn } = generateTokens(user, { kiosk: true });
    const access = jwt.decode(accessToken);
    const refresh = jwt.decode(refreshToken);

    assert.equal(access.exp, undefined);
    assert.equal(refresh.exp, undefined);
    assert.equal(expiresIn, null);
});

test('explicit accessTtl override is honored', () => {
    const { accessToken } = generateTokens(user, { accessTtl: '15m' });
    const access = jwt.decode(accessToken);
    const ttlSeconds = access.exp - access.iat;

    assert.ok(ttlSeconds >= 14 * 60 && ttlSeconds <= 16 * 60);
});

test('kiosk tokens keep the standard claims and session id', () => {
    const { accessToken, sessionId } = generateTokens(user, { kiosk: true, sessionId: 'kiosk-session' });
    const access = jwt.decode(accessToken);

    assert.equal(sessionId, 'kiosk-session');
    assert.equal(access.sessionId, 'kiosk-session');
    assert.equal(access.type, 'access');
    assert.equal(access.role, 'user');
});
