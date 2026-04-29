const assert = require('node:assert/strict');
const test = require('node:test');

const { createCache } = require('../src/services/footballCache');

test('returns the loader value and reuses it within the TTL', async () => {
    const cache = createCache({ now: () => 1_000 });
    let calls = 0;
    const load = async () => {
        calls += 1;
        return { value: calls };
    };

    const a = await cache.fetch('k', 5_000, load);
    const b = await cache.fetch('k', 5_000, load);

    assert.deepEqual(a, { value: 1 });
    assert.deepEqual(b, { value: 1 });
    assert.equal(calls, 1);
});

test('refetches after the TTL expires', async () => {
    let nowMs = 1_000;
    const cache = createCache({ now: () => nowMs });
    let calls = 0;
    const load = async () => {
        calls += 1;
        return calls;
    };

    await cache.fetch('k', 5_000, load);
    nowMs = 7_000;
    const second = await cache.fetch('k', 5_000, load);

    assert.equal(second, 2);
    assert.equal(calls, 2);
});

test('deduplicates concurrent loads (single-flight)', async () => {
    const cache = createCache();
    let inFlight = 0;
    let maxInFlight = 0;
    const load = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return 'value';
    };

    const results = await Promise.all([
        cache.fetch('k', 5_000, load),
        cache.fetch('k', 5_000, load),
        cache.fetch('k', 5_000, load),
    ]);

    assert.deepEqual(results, ['value', 'value', 'value']);
    assert.equal(maxInFlight, 1);
});

test('does not cache rejected loads', async () => {
    const cache = createCache();
    let calls = 0;
    const load = async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return 'ok';
    };

    await assert.rejects(() => cache.fetch('k', 5_000, load), /boom/);
    const second = await cache.fetch('k', 5_000, load);

    assert.equal(second, 'ok');
    assert.equal(calls, 2);
});

test('peek returns the cached value without firing the loader', async () => {
    const cache = createCache({ now: () => 1_000 });
    let calls = 0;
    await cache.fetch('k', 5_000, async () => {
        calls += 1;
        return 42;
    });

    assert.equal(cache.peek('k'), 42);
    assert.equal(cache.peek('missing'), undefined);
    assert.equal(calls, 1);
});

test('peek returns undefined after the entry has expired', async () => {
    let nowMs = 1_000;
    const cache = createCache({ now: () => nowMs });
    await cache.fetch('k', 5_000, async () => 99);

    nowMs = 10_000;
    assert.equal(cache.peek('k'), undefined);
});
