// Makes sure `field` has a TTL index (expireAfterSeconds: 0).
// Older schemas declared both `index: true` and a TTL index on the same key;
// Mongo kept the plain one, so documents never expired. This repairs that state.
async function ensureTtlIndex(collection, field) {
    let indexes = [];
    try {
        indexes = await collection.indexes();
    } catch (err) {
        if (err.codeName !== 'NamespaceNotFound') throw err;
    }

    const existing = indexes.find((idx) => {
        const keys = Object.keys(idx.key || {});
        return keys.length === 1 && idx.key[field] === 1;
    });

    if (existing && existing.expireAfterSeconds === 0) return 'ok';

    if (existing) await collection.dropIndex(existing.name);
    await collection.createIndex({ [field]: 1 }, { expireAfterSeconds: 0 });
    return existing ? 'repaired' : 'created';
}

module.exports = { ensureTtlIndex };
