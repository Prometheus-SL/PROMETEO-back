const GuildNotificationConfig = require('../../models/GuildNotificationConfig');
const { getClient } = require('./client');
const { createEpicFreeGamesProvider } = require('./providers/epicFreeGames');
const { createDiscordNewsMessenger } = require('./newsMessenger');
const { createChannelStateStore } = require('./channelStateStore');
const { getUserAdminGuilds } = require('./userGuildsService');

const EPIC_SOURCE = 'epicFreeGames';

const defaultProvider = createEpicFreeGamesProvider();
const defaultChannelStateStore = createChannelStateStore();

function publicEntry(doc) {
    const epic = doc?.epic ?? {};
    return {
        guildId: String(doc.guildId),
        channelId: epic.channelId ?? null,
        enabled: Boolean(epic.enabled),
        lastNotifiedAt: epic.lastNotifiedAt ?? null,
        lastError: epic.lastError ?? null,
        updatedBy: epic.updatedBy ? String(epic.updatedBy) : null,
        updatedAt: epic.updatedAt ?? null,
    };
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

async function getStatusForUser(userId, { Model = GuildNotificationConfig } = {}) {
    const { needsLink, needsReauth, guilds } = await getUserAdminGuilds(userId);
    if (needsLink || needsReauth) {
        return { configs: [], needsLink, needsReauth };
    }
    const guildIds = guilds.map((g) => g.id);
    if (guildIds.length === 0) return { configs: [], needsLink: false, needsReauth: false };

    const docs = await Model.find({ guildId: { $in: guildIds } }).lean();
    return {
        configs: docs.map(publicEntry),
        needsLink: false,
        needsReauth: false,
    };
}

async function saveStatusForUser(
    userId,
    incomingConfigs,
    {
        Model = GuildNotificationConfig,
        provider = defaultProvider,
        messengerFactory = createDiscordNewsMessenger,
        channelStateStore = defaultChannelStateStore,
    } = {},
) {
    const { needsLink, needsReauth, guilds } = await getUserAdminGuilds(userId);
    if (needsLink) {
        const err = new Error('Discord no está vinculado');
        err.status = 400;
        throw err;
    }
    if (needsReauth) {
        const err = new Error('Revincula Discord concediendo acceso a tus servidores');
        err.status = 400;
        throw err;
    }

    const allowedGuildIds = new Set(guilds.map((g) => g.id));
    const byGuild = new Map();
    for (const raw of Array.isArray(incomingConfigs) ? incomingConfigs : []) {
        const guildId = String(raw?.guildId ?? '');
        if (!guildId) {
            const err = new Error('Cada configuración requiere guildId');
            err.status = 400;
            throw err;
        }
        if (!allowedGuildIds.has(guildId)) {
            const err = new Error(`No eres admin/owner del servidor ${guildId}`);
            err.status = 403;
            throw err;
        }
        byGuild.set(guildId, {
            guildId,
            channelId: raw?.channelId ? String(raw.channelId) : null,
            enabled: Boolean(raw?.enabled),
        });
    }

    const incoming = Array.from(byGuild.values());
    for (const entry of incoming) {
        if (entry.enabled) {
            if (!entry.channelId) {
                const err = new Error(`Falta channelId para activar notificaciones en ${entry.guildId}`);
                err.status = 400;
                throw err;
            }
            await validateTextChannel({ guildId: entry.guildId, channelId: entry.channelId });
        }
    }

    const now = new Date();
    const warnings = [];

    for (const entry of incoming) {
        const prev = await Model.findOne({ guildId: entry.guildId });
        const wasEnabled = Boolean(prev?.epic?.enabled);
        const willBeEnabled = entry.enabled;

        const nextEpic = {
            enabled: willBeEnabled,
            channelId: willBeEnabled ? entry.channelId : (entry.channelId ?? prev?.epic?.channelId ?? null),
            lastNotifiedIds: prev?.epic?.lastNotifiedIds ?? [],
            lastNotifiedAt: prev?.epic?.lastNotifiedAt ?? null,
            lastError: null,
            updatedBy: userId,
            updatedAt: now,
        };

        if (willBeEnabled && !wasEnabled) {
            try {
                const games = await provider.fetchCurrentFreeGames();
                if (games.length > 0) {
                    const bot = getClient();
                    if (!bot) throw new Error('Discord bot is not connected');
                    const knownByChannel = await channelStateStore.getKnownIds(nextEpic.channelId, EPIC_SOURCE);
                    const gamesToSend = games.filter((g) => !knownByChannel.has(g.id));
                    const allIds = games.map((g) => g.id);

                    if (gamesToSend.length > 0) {
                        const messenger = messengerFactory({ client: bot });
                        await messenger.sendFreeGames(nextEpic.channelId, gamesToSend);
                        const nextChannelIds = Array.from(new Set([...knownByChannel, ...allIds]));
                        await channelStateStore.recordSent(nextEpic.channelId, EPIC_SOURCE, nextChannelIds);
                        nextEpic.lastNotifiedAt = now;
                    }
                    nextEpic.lastNotifiedIds = allIds;
                }
            } catch (err) {
                warnings.push(`${entry.guildId}: ${err.message}`);
                nextEpic.lastError = err.message;
            }
        }

        await Model.findOneAndUpdate(
            { guildId: entry.guildId },
            { guildId: entry.guildId, epic: nextEpic },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
    }

    const guildIds = guilds.map((g) => g.id);
    const docs = await Model.find({ guildId: { $in: guildIds } }).lean();
    return {
        configs: docs.map(publicEntry),
        warning: warnings.length ? warnings.join('; ') : null,
    };
}

async function listEnabledEpicConfigs({ Model = GuildNotificationConfig } = {}) {
    return Model.find({ 'epic.enabled': true });
}

module.exports = {
    getStatusForUser,
    saveStatusForUser,
    listEnabledEpicConfigs,
    publicEntry,
    EPIC_SOURCE,
};
