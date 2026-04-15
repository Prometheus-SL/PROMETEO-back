const { createNoopChannelStateStore } = require('./channelStateStore');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const EPIC_SOURCE = 'epicFreeGames';

async function tickUser(user, currentGames, messenger, channelStateStore = createNoopChannelStateStore()) {
    const state = user?.linkedAccounts?.discord?.notifications?.epicFreeGames;
    if (!state || !state.enabled || !state.channelId) {
        return { skipped: true, newGames: [], nextIds: state?.lastNotifiedIds ?? [], error: null };
    }

    const knownByUser = new Set(state.lastNotifiedIds ?? []);
    const newForUser = currentGames.filter((game) => !knownByUser.has(game.id));
    const nextIds = currentGames.map((g) => g.id);

    if (newForUser.length === 0) {
        return { skipped: false, newGames: [], nextIds, error: null };
    }

    let knownByChannel;
    try {
        knownByChannel = await channelStateStore.getKnownIds(state.channelId, EPIC_SOURCE);
    } catch (err) {
        return { skipped: false, newGames: newForUser, nextIds: state.lastNotifiedIds ?? [], error: err };
    }

    const newForChannel = newForUser.filter((game) => !knownByChannel.has(game.id));

    if (newForChannel.length === 0) {
        // Otro usuario ya notificó este canal con estos juegos. Sincronizamos
        // el estado del usuario para no reintentar, pero no volvemos a enviar.
        return { skipped: false, newGames: [], nextIds, error: null };
    }

    try {
        await messenger.sendFreeGames(state.channelId, newForChannel);
        const nextChannelIds = Array.from(new Set([...knownByChannel, ...nextIds]));
        await channelStateStore.recordSent(state.channelId, EPIC_SOURCE, nextChannelIds);
        return { skipped: false, newGames: newForChannel, nextIds, error: null };
    } catch (err) {
        return { skipped: false, newGames: newForChannel, nextIds: state.lastNotifiedIds ?? [], error: err };
    }
}

function createDiscordNewsScheduler({
    User,
    provider,
    messenger,
    channelStateStore = createNoopChannelStateStore(),
    intervalMs = POLL_INTERVAL_MS,
    logger = console,
}) {
    let timer = null;
    let running = false;

    async function runTick() {
        if (running) return;
        running = true;
        try {
            let games;
            try {
                games = await provider.fetchCurrentFreeGames();
            } catch (err) {
                logger.error('[DiscordNews] Epic provider failed, skipping tick:', err.message);
                return;
            }

            const users = await User.find({
                'linkedAccounts.discord.notifications.epicFreeGames.enabled': true,
            });

            for (const user of users) {
                const result = await tickUser(user, games, messenger, channelStateStore);
                if (result.skipped) continue;

                const epic = user.linkedAccounts.discord.notifications.epicFreeGames;
                if (result.error) {
                    epic.lastError = result.error.message || String(result.error);
                } else {
                    epic.lastNotifiedIds = result.nextIds;
                    epic.lastNotifiedAt = new Date();
                    epic.lastError = null;
                }
                try {
                    await user.save();
                } catch (err) {
                    logger.error(`[DiscordNews] Could not persist state for user ${user._id}:`, err.message);
                }
            }
        } catch (err) {
            logger.error('[DiscordNews] Unexpected tick failure:', err);
        } finally {
            running = false;
        }
    }

    return {
        start() {
            if (timer) return;
            timer = setInterval(runTick, intervalMs);
            // Fire one tick on start so a restart doesn't delay notifications by an hour.
            void runTick();
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
        runTick,
    };
}

module.exports = { tickUser, createDiscordNewsScheduler, POLL_INTERVAL_MS, EPIC_SOURCE };
