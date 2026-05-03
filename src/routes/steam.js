const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { ok } = require('../http/responses');
const {
    getSteamDeals,
    getSteamFriendsPresence,
} = require('../services/steamIntegration');

const router = express.Router();

router.get('/friends', authenticateToken, asyncHandler(async (req, res) => {
    const summary = await getSteamFriendsPresence(req.user, {
        limit: req.query.limit,
        maxFriendsToInspect: req.query.maxFriendsToInspect,
    });

    return ok(res, summary);
}));

router.get('/deals', authenticateToken, asyncHandler(async (req, res) => {
    const deals = await getSteamDeals({
        country: req.query.country,
        language: req.query.language,
        limit: req.query.limit,
    });

    return ok(res, deals);
}));

module.exports = router;
