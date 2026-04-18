const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { initBot, getStatus, getGuildInfo, getInviteUrl, disconnectVoiceMember, setVoiceMute, getMemberPermissions } = require('../services/discord/client');
const guildConfigService = require('../services/discord/guildConfigService');
const { getUserAdminGuilds } = require('../services/discord/userGuildsService');
const User = require('../models/User');

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

router.get('/guilds/:guildId/me/permissions', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).lean();
    const linked = user?.linkedAccounts?.discord;
    const discordId = linked?.status === 'connected' ? linked.profile?.id ?? null : null;
    const data = await getMemberPermissions(req.params.guildId, discordId);
    return ok(res, data);
}));

router.get('/my-guilds', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const data = await getUserAdminGuilds(req.user._id);
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
    const state = await guildConfigService.getStatusForUser(req.user._id);
    return ok(res, state);
}));

router.post('/notifications/epic', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const configs = Array.isArray(req.body?.configs) ? req.body.configs : null;
    if (!configs) {
        throw createHttpError(400, 'INVALID_BODY', 'Expected { configs: [{ guildId, channelId, enabled }] }');
    }
    const normalized = configs.map((c) => ({
        guildId: typeof c?.guildId === 'string' ? c.guildId : '',
        channelId: typeof c?.channelId === 'string' ? c.channelId : '',
        enabled: Boolean(c?.enabled),
    }));
    const result = await guildConfigService.saveStatusForUser(req.user._id, normalized);
    return ok(res, result);
}));

module.exports = router;
