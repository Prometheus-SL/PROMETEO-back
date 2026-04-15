const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { initBot, getStatus, getGuildInfo, getInviteUrl, disconnectVoiceMember, setVoiceMute } = require('../services/discord/client');
const notificationsService = require('../services/discord/notificationsService');

const router = express.Router();

async function ensureBot(_req, _res, next) {
    try {
        await initBot();
        next();
    } catch (error) {
        next(error);
    }
}

router.get('/status', authenticateToken, ensureBot, asyncHandler(async (_req, res) => {
    return ok(res, getStatus());
}));

router.get('/guilds/:guildId', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const data = await getGuildInfo(req.params.guildId);
    return ok(res, data);
}));

router.post('/guilds/:guildId/voice/:userId/disconnect', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const data = await disconnectVoiceMember(req.params.guildId, req.params.userId);
    return ok(res, data);
}));

router.post('/guilds/:guildId/voice/:userId/mute', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const mute = req.body?.mute !== false;
    const data = await setVoiceMute(req.params.guildId, req.params.userId, mute);
    return ok(res, data);
}));

router.get('/invite', authenticateToken, ensureBot, asyncHandler(async (_req, res) => {
    const url = getInviteUrl();
    if (!url) {
        throw createHttpError(503, 'BOT_NOT_READY', 'Discord bot is not connected');
    }

    return ok(res, { url });
}));

router.get('/notifications/epic', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const state = await notificationsService.getStatus(req.user._id);
    return ok(res, state);
}));

router.post('/notifications/epic', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const { enabled, channelId, guildId } = req.body ?? {};
    const result = await notificationsService.saveStatus(req.user._id, {
        enabled: Boolean(enabled),
        channelId: typeof channelId === 'string' ? channelId : null,
        guildId: typeof guildId === 'string' ? guildId : null,
    });
    return ok(res, result);
}));

module.exports = router;
