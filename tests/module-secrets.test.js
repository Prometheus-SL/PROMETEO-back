const assert = require('node:assert/strict');
const test = require('node:test');

process.env.LINKED_ACCOUNTS_ENCRYPTION_KEY = process.env.LINKED_ACCOUNTS_ENCRYPTION_KEY || 'test-module-secrets-key';

const {
    SECRET_MASK,
    encryptConfigSecrets,
    decryptConfigSecrets,
    maskConfigSecrets,
    isEncryptedSecret,
} = require('../src/services/moduleSecrets');

test('encrypts secret config fields and leaves others untouched', () => {
    const enc = encryptConfigSecrets('lifx-widget', { apiToken: 'tok-123', refreshInterval: 5 });
    assert.equal(isEncryptedSecret(enc.apiToken), true);
    assert.equal(enc.refreshInterval, 5);
    assert.notEqual(enc.apiToken, 'tok-123');
});

test('round-trips: encrypt -> decrypt restores the plaintext secret', () => {
    const enc = encryptConfigSecrets('lifx-widget', { apiToken: 'tok-123' });
    assert.equal(decryptConfigSecrets('lifx-widget', enc).apiToken, 'tok-123');
});

test('masks secrets for the client', () => {
    const enc = encryptConfigSecrets('lifx-widget', { apiToken: 'tok-123' });
    assert.equal(maskConfigSecrets('lifx-widget', enc).apiToken, SECRET_MASK);
});

test('placeholder on update keeps the existing encrypted secret', () => {
    const existing = encryptConfigSecrets('lifx-widget', { apiToken: 'tok-123' });
    const updated = encryptConfigSecrets('lifx-widget', { apiToken: SECRET_MASK }, existing);
    assert.deepEqual(updated.apiToken, existing.apiToken);
    assert.equal(decryptConfigSecrets('lifx-widget', updated).apiToken, 'tok-123');
});

test('placeholder migrates a legacy plaintext secret to encrypted', () => {
    const updated = encryptConfigSecrets('lifx-widget', { apiToken: SECRET_MASK }, { apiToken: 'legacy-plain' });
    assert.equal(isEncryptedSecret(updated.apiToken), true);
    assert.equal(decryptConfigSecrets('lifx-widget', updated).apiToken, 'legacy-plain');
});

test('non-secret modules are returned unchanged', () => {
    const cfg = { city: 'Madrid', refreshInterval: 5 };
    assert.deepEqual(encryptConfigSecrets('weather-widget', cfg), cfg);
    assert.deepEqual(maskConfigSecrets('weather-widget', cfg), cfg);
    assert.deepEqual(decryptConfigSecrets('weather-widget', cfg), cfg);
});
