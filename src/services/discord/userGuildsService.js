const User = require('../../models/User');
const { getClient } = require('./client');
const {
    fetchDiscordUserGuilds,
    getValidDiscordAccessToken,
} = require('../discordIntegration');

const ADMINISTRATOR_BIT = 0x8n;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

function buildIconUrl(guildId, iconHash) {
    if (!guildId || !iconHash) return null;
    const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=128`;
}

function hasGuildsScope(discord) {
    const scopes = Array.isArray(discord?.scopes) ? discord.scopes : [];
    return scopes.includes('guilds');
}

function isRateLimitError(err) {
    return err?.details?.status === 429 || /rate limit|limitad/i.test(err?.message || '');
}

function enrichWithBotPresence(rawGuilds) {
    const bot = getClient();
    const botGuildIds = bot
        ? new Set(bot.guilds.cache.map((g) => g.id))
        : new Set();

    const guilds = [];
    for (const g of rawGuilds) {
        const permissions = BigInt(g.permissions ?? g.permissions_new ?? '0');
        const isAdmin = (permissions & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
        const isOwner = Boolean(g.owner);
        if (!isAdmin && !isOwner) continue;

        guilds.push({
            id: String(g.id),
            name: String(g.name ?? ''),
            icon: buildIconUrl(String(g.id), g.icon ?? null),
            isAdmin,
            isOwner,
            hasLinkedDiscord: true,
            botPresent: botGuildIds.has(String(g.id)),
        });
    }
    return guilds;
}

async function getUserAdminGuilds(userDocId) {
    const user = await User.findById(userDocId);
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }

    const discord = user.linkedAccounts?.discord;
    if (discord?.status !== 'connected') {
        return { needsLink: true, needsReauth: false, guilds: [] };
    }

    if (!hasGuildsScope(discord)) {
        return { needsLink: false, needsReauth: true, guilds: [] };
    }

    const cacheKey = String(userDocId);
    const cached = cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.at < CACHE_TTL_MS) {
        return {
            needsLink: false,
            needsReauth: false,
            guilds: enrichWithBotPresence(cached.raw),
        };
    }

    let raw;
    try {
        const accessToken = await getValidDiscordAccessToken(user);
        raw = await fetchDiscordUserGuilds(accessToken);
        cache.set(cacheKey, { at: now, raw });
    } catch (err) {
        if (isRateLimitError(err) && cached) {
            return {
                needsLink: false,
                needsReauth: false,
                guilds: enrichWithBotPresence(cached.raw),
            };
        }
        throw err;
    }

    return {
        needsLink: false,
        needsReauth: false,
        guilds: enrichWithBotPresence(raw),
    };
}

function __clearCacheForTests() {
    cache.clear();
}

module.exports = { getUserAdminGuilds, __clearCacheForTests };
