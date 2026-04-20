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

router.post('/graphql', authenticateToken, asyncHandler(async (req, res) => {
    const { query, variables } = req.body || {};
    if (!query || typeof query !== 'string') {
        throw createHttpError(400, 'GRAPHQL_QUERY_REQUIRED', 'A GraphQL query string is required');
    }

    const data = await githubGraphQL(req.user, query, variables || {});
    return ok(res, { data });
}));

module.exports = router;
