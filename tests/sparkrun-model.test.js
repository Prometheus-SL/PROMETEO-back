const test = require('node:test');
const assert = require('node:assert/strict');
const SparkRun = require('../src/models/SparkRun');

test('SparkRun declares exactly one index on expiresAt, and it is the TTL index', () => {
    const expiresIndexes = SparkRun.schema
        .indexes()
        .filter(([fields]) => Object.keys(fields).length === 1 && fields.expiresAt === 1);

    assert.equal(expiresIndexes.length, 1);
    assert.equal(expiresIndexes[0][1].expireAfterSeconds, 0);
});
