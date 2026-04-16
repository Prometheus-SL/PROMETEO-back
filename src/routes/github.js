const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { ok } = require('../http/responses');
const { getGithubPulse } = require('../services/githubIntegration');

const router = express.Router();

router.get('/pulse', authenticateToken, asyncHandler(async (req, res) => {
    const pulse = await getGithubPulse(req.user, {
        notificationsLimit: req.query.notificationsLimit,
        pullsLimit: req.query.pullsLimit,
    });

    return ok(res, pulse);
}));

module.exports = router;
