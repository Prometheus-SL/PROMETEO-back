const assert = require('node:assert/strict');
const test = require('node:test');

const { hashApiKey, isHashedApiKey } = require('../src/services/agentApiKey');

test('hashApiKey is deterministic, prefixed and not the plaintext', () => {
    const plain = 'abc123';
    const hashed = hashApiKey(plain);

    assert.equal(hashed, hashApiKey(plain)); // determinista
    assert.ok(hashed.startsWith('v2$'));
    assert.notEqual(hashed, plain);
    assert.notEqual(hashApiKey('other'), hashed);
});

test('isHashedApiKey distinguishes hashed from legacy plaintext', () => {
    assert.equal(isHashedApiKey(hashApiKey('x')), true);
    assert.equal(isHashedApiKey('a'.repeat(64)), false); // clave legacy en claro
    assert.equal(isHashedApiKey(''), false);
    assert.equal(isHashedApiKey(null), false);
});
