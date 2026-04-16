const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { ok } = require('../http/responses');
const { getCreatorDashboardStatus } = require('../services/creatorIntegration');

const router = express.Router();

router.get('/status', authenticateToken, asyncHandler(async (_req, res) => {
    const status = await getCreatorDashboardStatus();
    return ok(res, status);
}));

module.exports = router;
