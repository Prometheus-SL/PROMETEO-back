const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { initBot, getStatus, getGuildInfo, getInviteUrl, disconnectVoiceMember, setVoiceMute, getMemberPermissions } = require('../services/discord/client');
const guildConfigService = require('../services/discord/guildConfigService');
const gameUpdatesService = require('../services/discord/gameUpdatesService');
const artistReleasesService = require('../services/discord/artistReleasesService');
const { getSharedCatalog } = require('../services/discord/steamCatalog');
const { getUserAdminGuilds } = require('../services/discord/userGuildsService');
const { createSpotifyArtistCatalog } = require('../services/discord/spotifyArtistCatalog');
const { createSpotifyReleasesProvider, createSpotifyTokenProvider } = require('../services/discord/providers/spotifyReleases');
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

router.get('/games/search', authenticateToken, asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 20;
    const catalog = getSharedCatalog();
    const results = catalog.search ? await catalog.search(q, { limit }) : [];
    return ok(res, { results });
}));

router.get('/notifications/game-updates', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const state = await gameUpdatesService.getStatusForUser(req.user._id);
    return ok(res, state);
}));

router.post('/notifications/game-updates', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    const configs = Array.isArray(req.body?.configs) ? req.body.configs : null;
    if (!configs) {
        throw createHttpError(400, 'INVALID_BODY', 'Expected { configs: [{ guildId, channelId, enabled, subscriptions }] }');
    }
    const normalized = configs.map((c) => ({
        guildId: typeof c?.guildId === 'string' ? c.guildId : '',
        channelId: typeof c?.channelId === 'string' ? c.channelId : null,
        enabled: Boolean(c?.enabled),
        subscriptions: Array.isArray(c?.subscriptions)
            ? c.subscriptions.map((s) => ({ appId: Number(s?.appId) })).filter((s) => Number.isFinite(s.appId))
            : [],
    }));
    const result = await gameUpdatesService.saveStatusForUser(req.user._id, normalized);
    return ok(res, result);
}));

router.get('/artists/search', authenticateToken, asyncHandler(async (req, res) => {
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        throw createHttpError(503, 'SPOTIFY_NOT_CONFIGURED', 'Spotify not configured');
    }

    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 10) : 10;

    const tokenProvider = createSpotifyTokenProvider({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });
    const provider = createSpotifyReleasesProvider({ tokenProvider });
    const catalog = createSpotifyArtistCatalog({ provider });

    const results = await catalog.search(q, { limit });
    return ok(res, { results });
}));

router.get('/notifications/artist-releases', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        throw createHttpError(503, 'SPOTIFY_NOT_CONFIGURED', 'Spotify not configured');
    }

    const state = await artistReleasesService.getStatusForUser(req.user._id);
    return ok(res, state);
}));

router.post('/notifications/artist-releases', authenticateToken, ensureBot, asyncHandler(async (req, res) => {
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        throw createHttpError(503, 'SPOTIFY_NOT_CONFIGURED', 'Spotify not configured');
    }

    const configs = Array.isArray(req.body?.configs) ? req.body.configs : null;
    if (!configs) {
        throw createHttpError(400, 'INVALID_BODY', 'Expected { configs: [{ guildId, channelId, enabled, includeTypes, subscriptions }] }');
    }

    const normalized = configs.map((c) => ({
        guildId: typeof c?.guildId === 'string' ? c.guildId : '',
        channelId: typeof c?.channelId === 'string' ? c.channelId : null,
        enabled: Boolean(c?.enabled),
        includeTypes: Array.isArray(c?.includeTypes)
            ? c.includeTypes.filter((t) => ['album', 'single', 'compilation', 'appears_on'].includes(t))
            : [],
        subscriptions: Array.isArray(c?.subscriptions)
            ? c.subscriptions.map((s) => ({ artistId: String(s?.artistId ?? '').trim() })).filter((s) => s.artistId)
            : [],
    }));

    const tokenProvider = createSpotifyTokenProvider({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });
    const provider = createSpotifyReleasesProvider({ tokenProvider });
    const catalog = createSpotifyArtistCatalog({ provider });

    const { configs: resultConfigs, needsLink, needsReauth } = await artistReleasesService.saveStatusForUser(req.user._id, normalized, {
        catalog,
        provider,
    });
    return ok(res, { configs: resultConfigs, warning: null, needsLink, needsReauth });
}));

module.exports = router;
