const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { getGithubPulse, githubGraphQL } = require('../services/githubIntegration');

const router = express.Router();

router.get('/pulse', authenticateToken, asyncHandler(async (req, res) => {
    const pulse = await getGithubPulse(req.user, {
        notificationsLimit: req.query.notificationsLimit,
        pullsLimit: req.query.pullsLimit,
    });

    return ok(res, pulse);
}));

// El proxy es de SOLO LECTURA: rechaza mutation/subscription para que un widget
// (o un token filtrado) no pueda escribir en la cuenta de GitHub del usuario.
function isReadOnlyGraphQL(query) {
    const withoutComments = String(query).replace(/#[^\n\r]*/g, ' ');
    return !/\b(mutation|subscription)\b/i.test(withoutComments);
}

router.post('/graphql', authenticateToken, asyncHandler(async (req, res) => {
    const { query, variables } = req.body || {};
    if (!query || typeof query !== 'string') {
        throw createHttpError(400, 'GRAPHQL_QUERY_REQUIRED', 'A GraphQL query string is required');
    }

    if (!isReadOnlyGraphQL(query)) {
        throw createHttpError(403, 'GRAPHQL_READ_ONLY', 'Only read-only GraphQL queries are allowed');
    }

    const data = await githubGraphQL(req.user, query, variables || {});
    return ok(res, { data });
}));

module.exports = router;
module.exports.isReadOnlyGraphQL = isReadOnlyGraphQL;
