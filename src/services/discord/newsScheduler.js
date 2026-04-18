const { createNoopChannelStateStore } = require('./channelStateStore');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const EPIC_SOURCE = 'epicFreeGames';

function readEntries(user) {
    const raw = user?.linkedAccounts?.discord?.notifications?.epicFreeGames;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && raw.guildId) return [raw];
    return [];
}

async function tickEntry(entry, currentGames, messenger, channelStateStore = createNoopChannelStateStore()) {
    if (!entry || !entry.enabled || !entry.channelId) {
        return { skipped: true, newGames: [], nextIds: entry?.lastNotifiedIds ?? [], error: null };
    }

    const knownByUser = new Set(entry.lastNotifiedIds ?? []);
    const newForUser = currentGames.filter((game) => !knownByUser.has(game.id));
    const nextIds = currentGames.map((g) => g.id);

    if (newForUser.length === 0) {
        return { skipped: false, newGames: [], nextIds, error: null };
    }

    let knownByChannel;
    try {
        knownByChannel = await channelStateStore.getKnownIds(entry.channelId, EPIC_SOURCE);
    } catch (err) {
        return { skipped: false, newGames: newForUser, nextIds: entry.lastNotifiedIds ?? [], error: err };
    }

    const newForChannel = newForUser.filter((game) => !knownByChannel.has(game.id));

    if (newForChannel.length === 0) {
        return { skipped: false, newGames: [], nextIds, error: null };
    }

    try {
        await messenger.sendFreeGames(entry.channelId, newForChannel);
        const nextChannelIds = Array.from(new Set([...knownByChannel, ...nextIds]));
        await channelStateStore.recordSent(entry.channelId, EPIC_SOURCE, nextChannelIds);
        return { skipped: false, newGames: newForChannel, nextIds, error: null };
    } catch (err) {
        return { skipped: false, newGames: newForChannel, nextIds: entry.lastNotifiedIds ?? [], error: err };
    }
}

// Back-compat wrapper: old signature tickUser(user, ...) picks first entry.
async function tickUser(user, currentGames, messenger, channelStateStore) {
    const entries = readEntries(user);
    const entry = entries[0];
    return tickEntry(entry, currentGames, messenger, channelStateStore);
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
                const entries = readEntries(user);
                let dirty = false;
                for (const entry of entries) {
                    if (!entry.enabled || !entry.channelId) continue;
                    const result = await tickEntry(entry, games, messenger, channelStateStore);
                    if (result.skipped) continue;
                    if (result.error) {
                        entry.lastError = result.error.message || String(result.error);
                    } else {
                        entry.lastNotifiedIds = result.nextIds;
                        entry.lastNotifiedAt = new Date();
                        entry.lastError = null;
                    }
                    dirty = true;
                }
                if (!dirty) continue;
                user.markModified('linkedAccounts.discord.notifications.epicFreeGames');
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

module.exports = { tickUser, tickEntry, createDiscordNewsScheduler, POLL_INTERVAL_MS, EPIC_SOURCE };
