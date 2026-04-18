const User = require('../../models/User');
const { getClient } = require('./client');
const { createEpicFreeGamesProvider } = require('./providers/epicFreeGames');
const { createDiscordNewsMessenger } = require('./newsMessenger');
const { createChannelStateStore } = require('./channelStateStore');
const { EPIC_SOURCE } = require('./newsScheduler');

const defaultProvider = createEpicFreeGamesProvider();
const defaultChannelStateStore = createChannelStateStore();

function normalizeEntry(raw) {
    return {
        guildId: String(raw?.guildId ?? ''),
        channelId: raw?.channelId ? String(raw.channelId) : null,
        enabled: Boolean(raw?.enabled),
        lastNotifiedIds: Array.isArray(raw?.lastNotifiedIds) ? raw.lastNotifiedIds : [],
        lastNotifiedAt: raw?.lastNotifiedAt ?? null,
        lastError: raw?.lastError ?? null,
    };
}

function readEntries(user) {
    const raw = user?.linkedAccounts?.discord?.notifications?.epicFreeGames;
    if (Array.isArray(raw)) {
        return raw.map(normalizeEntry);
    }
    // Legacy object-shape fallback
    if (raw && typeof raw === 'object' && raw.guildId) {
        return [normalizeEntry(raw)];
    }
    return [];
}

function publicEntry(entry) {
    return {
        guildId: entry.guildId,
        channelId: entry.channelId,
        enabled: Boolean(entry.enabled),
        lastNotifiedAt: entry.lastNotifiedAt ?? null,
        lastError: entry.lastError ?? null,
    };
}

async function getStatus(userId) {
    const user = await User.findById(userId);
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }
    return { configs: readEntries(user).map(publicEntry) };
}

async function validateTextChannel({ guildId, channelId }) {
    const bot = getClient();
    if (!bot) {
        const err = new Error('Discord bot is not connected');
        err.status = 503;
        throw err;
    }
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
        const err = new Error('El bot no está en ese servidor');
        err.status = 400;
        throw err;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== 0) {
        const err = new Error('El canal elegido no es un canal de texto del servidor');
        err.status = 400;
        throw err;
    }
}

function dedupeByGuild(entries) {
    const byGuild = new Map();
    for (const entry of entries) {
        if (!entry.guildId) continue;
        byGuild.set(entry.guildId, entry);
    }
    return Array.from(byGuild.values());
}

async function saveStatus(userId, incomingConfigs, {
    provider = defaultProvider,
    messengerFactory = createDiscordNewsMessenger,
    channelStateStore = defaultChannelStateStore,
} = {}) {
    const user = await User.findById(userId);
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }

    const normalizedIncoming = dedupeByGuild(
        (Array.isArray(incomingConfigs) ? incomingConfigs : []).map(normalizeEntry),
    );

    for (const entry of normalizedIncoming) {
        if (!entry.guildId) {
            const err = new Error('Cada configuración requiere guildId');
            err.status = 400;
            throw err;
        }
        if (entry.enabled) {
            if (!entry.channelId) {
                const err = new Error(`Falta channelId para activar notificaciones en ${entry.guildId}`);
                err.status = 400;
                throw err;
            }
            await validateTextChannel({ guildId: entry.guildId, channelId: entry.channelId });
        }
    }

    user.linkedAccounts = user.linkedAccounts || {};
    user.linkedAccounts.discord = user.linkedAccounts.discord || {};
    user.linkedAccounts.discord.notifications = user.linkedAccounts.discord.notifications || {};

    const existing = readEntries(user);
    const existingByGuild = new Map(existing.map((e) => [e.guildId, e]));

    const warnings = [];
    const nextEntries = [];

    for (const incoming of normalizedIncoming) {
        const prev = existingByGuild.get(incoming.guildId) || {
            lastNotifiedIds: [],
            lastNotifiedAt: null,
            enabled: false,
        };

        const wasEnabled = Boolean(prev.enabled);
        const willBeEnabled = Boolean(incoming.enabled);

        const nextEntry = {
            guildId: incoming.guildId,
            channelId: willBeEnabled ? incoming.channelId : (incoming.channelId ?? prev.channelId ?? null),
            enabled: willBeEnabled,
            lastNotifiedIds: prev.lastNotifiedIds ?? [],
            lastNotifiedAt: prev.lastNotifiedAt ?? null,
            lastError: null,
        };

        if (willBeEnabled && !wasEnabled) {
            try {
                const games = await provider.fetchCurrentFreeGames();
                if (games.length > 0) {
                    const bot = getClient();
                    if (!bot) throw new Error('Discord bot is not connected');
                    const knownByChannel = await channelStateStore.getKnownIds(nextEntry.channelId, EPIC_SOURCE);
                    const gamesToSend = games.filter((g) => !knownByChannel.has(g.id));
                    const allIds = games.map((g) => g.id);

                    if (gamesToSend.length > 0) {
                        const messenger = messengerFactory({ client: bot });
                        await messenger.sendFreeGames(nextEntry.channelId, gamesToSend);
                        const nextChannelIds = Array.from(new Set([...knownByChannel, ...allIds]));
                        await channelStateStore.recordSent(nextEntry.channelId, EPIC_SOURCE, nextChannelIds);
                        nextEntry.lastNotifiedAt = new Date();
                    }
                    nextEntry.lastNotifiedIds = allIds;
                }
            } catch (err) {
                warnings.push(`${incoming.guildId}: ${err.message}`);
                nextEntry.lastError = err.message;
            }
        }

        nextEntries.push(nextEntry);
    }

    user.linkedAccounts.discord.notifications.epicFreeGames = nextEntries;
    user.markModified('linkedAccounts.discord.notifications.epicFreeGames');
    await user.save();

    return {
        configs: readEntries(user).map(publicEntry),
        warning: warnings.length ? warnings.join('; ') : null,
    };
}

module.exports = { getStatus, saveStatus, readEntries };
