const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureTtlIndex } = require('../src/config/ttlIndexRepair');

function fakeCollection(indexes) {
    const calls = [];
    return {
        calls,
        async indexes() { return indexes; },
        async dropIndex(name) { calls.push(['drop', name]); },
        async createIndex(keys, options) { calls.push(['create', keys, options]); },
    };
}

test('drops a plain index on the field and recreates it as TTL', async () => {
    const col = fakeCollection([
        { name: '_id_', key: { _id: 1 } },
        { name: 'expiresAt_1', key: { expiresAt: 1 } },
    ]);
    const result = await ensureTtlIndex(col, 'expiresAt');
    assert.equal(result, 'repaired');
    assert.deepEqual(col.calls, [
        ['drop', 'expiresAt_1'],
        ['create', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ]);
});

test('leaves an existing TTL index alone', async () => {
    const col = fakeCollection([
        { name: 'expiresAt_1', key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
    assert.equal(await ensureTtlIndex(col, 'expiresAt'), 'ok');
    assert.deepEqual(col.calls, []);
});

test('creates the TTL index when none exists', async () => {
    const col = fakeCollection([{ name: '_id_', key: { _id: 1 } }]);
    assert.equal(await ensureTtlIndex(col, 'expiresAt'), 'created');
    assert.deepEqual(col.calls, [['create', { expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
});

test('treats a missing collection as nothing to repair', async () => {
    const col = fakeCollection([]);
    col.indexes = async () => { const e = new Error('ns does not exist'); e.codeName = 'NamespaceNotFound'; throw e; };
    assert.equal(await ensureTtlIndex(col, 'expiresAt'), 'created');
    assert.deepEqual(col.calls, [['create', { expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
});
