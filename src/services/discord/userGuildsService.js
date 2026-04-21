const User = require('../../models/User');
const { getClient } = require('./client');
const {
    fetchDiscordUserGuilds,
    getValidDiscordAccessToken,
} = require('../discordIntegration');

const ADMINISTRATOR_BIT = 0x8n;
const CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_NEGATIVE_CACHE_MS = 60 * 1000;
const MAX_NEGATIVE_CACHE_MS = 15 * 60 * 1000;

const cache = new Map();
const negativeCache = new Map();
const inFlight = new Map();

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
    return (
        err?.code === 'DISCORD_RATE_LIMITED' ||
        err?.details?.httpStatus === 429 ||
        err?.status === 429
    );
}

function getRetryAfterMs(err) {
    const sec = Number(err?.details?.retryAfterSec);
    if (Number.isFinite(sec) && sec > 0) {
        return Math.min(sec * 1000, MAX_NEGATIVE_CACHE_MS);
    }
    return DEFAULT_NEGATIVE_CACHE_MS;
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
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && now - cached.at < CACHE_TTL_MS) {
        return {
            needsLink: false,
            needsReauth: false,
            guilds: enrichWithBotPresence(cached.raw),
        };
    }

    const blockedUntil = negativeCache.get(cacheKey);
    if (blockedUntil && blockedUntil > now) {
        return {
            needsLink: false,
            needsReauth: false,
            guilds: cached ? enrichWithBotPresence(cached.raw) : [],
            rateLimited: true,
        };
    }

    let pending = inFlight.get(cacheKey);
    if (!pending) {
        pending = (async () => {
            const accessToken = await getValidDiscordAccessToken(user);
            return fetchDiscordUserGuilds(accessToken);
        })()
            .then((raw) => {
                cache.set(cacheKey, { at: Date.now(), raw });
                negativeCache.delete(cacheKey);
                return { raw };
            })
            .catch((err) => {
                if (isRateLimitError(err)) {
                    negativeCache.set(cacheKey, Date.now() + getRetryAfterMs(err));
                    return { rateLimited: true };
                }
                throw err;
            })
            .finally(() => {
                inFlight.delete(cacheKey);
            });
        inFlight.set(cacheKey, pending);
    }

    const outcome = await pending;

    if (outcome.rateLimited) {
        const fallback = cache.get(cacheKey);
        return {
            needsLink: false,
            needsReauth: false,
            guilds: fallback ? enrichWithBotPresence(fallback.raw) : [],
            rateLimited: true,
        };
    }

    return {
        needsLink: false,
        needsReauth: false,
        guilds: enrichWithBotPresence(outcome.raw),
    };
}

function __clearCacheForTests() {
    cache.clear();
    negativeCache.clear();
    inFlight.clear();
}

module.exports = { getUserAdminGuilds, __clearCacheForTests };
