const assert = require('node:assert/strict');
const test = require('node:test');

const { isReadOnlyGraphQL } = require('../src/routes/github');

test('allows read-only queries', () => {
    assert.equal(isReadOnlyGraphQL('query { viewer { login } }'), true);
    assert.equal(isReadOnlyGraphQL('{ viewer { login } }'), true);
    // "mutation" escondido en un comentario no debe contar como operación.
    assert.equal(isReadOnlyGraphQL('# mutation example\nquery { viewer { login } }'), true);
});

test('rejects mutations and subscriptions', () => {
    assert.equal(isReadOnlyGraphQL('mutation { addStar(input: {}) { clientMutationId } }'), false);
    assert.equal(isReadOnlyGraphQL('  mutation Foo { x }'), false);
    assert.equal(isReadOnlyGraphQL('subscription { onEvent { id } }'), false);
});
