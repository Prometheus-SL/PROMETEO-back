const User = require('../../models/User');
const { getClient } = require('./client');
const { createEpicFreeGamesProvider } = require('./providers/epicFreeGames');
const { createDiscordNewsMessenger } = require('./newsMessenger');
const { createChannelStateStore } = require('./channelStateStore');
const { EPIC_SOURCE } = require('./newsScheduler');

const defaultProvider = createEpicFreeGamesProvider();
const defaultChannelStateStore = createChannelStateStore();

function readState(user) {
    const epic = user?.linkedAccounts?.discord?.notifications?.epicFreeGames;
    return {
        enabled: Boolean(epic?.enabled),
        channelId: epic?.channelId ?? null,
        guildId: epic?.guildId ?? null,
        lastNotifiedAt: epic?.lastNotifiedAt ?? null,
        lastError: epic?.lastError ?? null,
    };
}

async function getStatus(userId) {
    const user = await User.findById(userId);
    if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
    }
    return readState(user);
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

async function saveStatus(userId, { enabled, channelId, guildId }, {
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

    user.linkedAccounts = user.linkedAccounts || {};
    user.linkedAccounts.discord = user.linkedAccounts.discord || {};
    user.linkedAccounts.discord.notifications = user.linkedAccounts.discord.notifications || {};

    const current = user.linkedAccounts.discord.notifications.epicFreeGames || {
        enabled: false,
        lastNotifiedIds: [],
    };

    const wasEnabled = Boolean(current.enabled);
    const willBeEnabled = Boolean(enabled);

    if (willBeEnabled) {
        if (!channelId || !guildId) {
            const err = new Error('channelId y guildId son obligatorios para activar notificaciones');
            err.status = 400;
            throw err;
        }
        await validateTextChannel({ guildId, channelId });
    }

    const nextState = {
        enabled: willBeEnabled,
        channelId: willBeEnabled ? channelId : (current.channelId ?? null),
        guildId: willBeEnabled ? guildId : (current.guildId ?? null),
        lastNotifiedIds: current.lastNotifiedIds ?? [],
        lastNotifiedAt: current.lastNotifiedAt ?? null,
        lastError: null,
    };

    let warning = null;

    if (willBeEnabled && !wasEnabled) {
        try {
            const games = await provider.fetchCurrentFreeGames();
            if (games.length > 0) {
                const bot = getClient();
                if (!bot) {
                    throw new Error('Discord bot is not connected');
                }
                const knownByChannel = await channelStateStore.getKnownIds(channelId, EPIC_SOURCE);
                const gamesToSend = games.filter((g) => !knownByChannel.has(g.id));
                const allIds = games.map((g) => g.id);

                if (gamesToSend.length > 0) {
                    const messenger = messengerFactory({ client: bot });
                    await messenger.sendFreeGames(channelId, gamesToSend);
                    const nextChannelIds = Array.from(new Set([...knownByChannel, ...allIds]));
                    await channelStateStore.recordSent(channelId, EPIC_SOURCE, nextChannelIds);
                    nextState.lastNotifiedAt = new Date();
                }
                // En ambos casos sincronizamos el estado del usuario con los IDs actuales,
                // para que el próximo tick no vuelva a reintentar los mismos juegos.
                nextState.lastNotifiedIds = allIds;
            }
        } catch (err) {
            warning = `notifications_saved_but_initial_send_failed: ${err.message}`;
            nextState.lastError = err.message;
        }
    }

    user.linkedAccounts.discord.notifications.epicFreeGames = nextState;
    user.markModified('linkedAccounts.discord.notifications.epicFreeGames');
    await user.save();

    return { state: readState(user), warning };
}

module.exports = { getStatus, saveStatus };
