const { createNoopChannelStateStore } = require('./channelStateStore');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const EPIC_SOURCE = 'epicFreeGames';

async function tickGuildConfig(config, currentGames, messenger, channelStateStore = createNoopChannelStateStore()) {
    const epic = config?.epic;
    if (!epic || !epic.enabled || !epic.channelId) {
        return { skipped: true, newGames: [], nextIds: epic?.lastNotifiedIds ?? [], error: null };
    }

    const knownByGuild = new Set(epic.lastNotifiedIds ?? []);
    const newForGuild = currentGames.filter((game) => !knownByGuild.has(game.id));
    const nextIds = currentGames.map((g) => g.id);

    if (newForGuild.length === 0) {
        return { skipped: false, newGames: [], nextIds, error: null };
    }

    let knownByChannel;
    try {
        knownByChannel = await channelStateStore.getKnownIds(epic.channelId, EPIC_SOURCE);
    } catch (err) {
        return { skipped: false, newGames: newForGuild, nextIds: epic.lastNotifiedIds ?? [], error: err };
    }

    const newForChannel = newForGuild.filter((game) => !knownByChannel.has(game.id));

    if (newForChannel.length === 0) {
        return { skipped: false, newGames: [], nextIds, error: null };
    }

    try {
        await messenger.sendFreeGames(epic.channelId, newForChannel);
        const nextChannelIds = Array.from(new Set([...knownByChannel, ...nextIds]));
        await channelStateStore.recordSent(epic.channelId, EPIC_SOURCE, nextChannelIds);
        return { skipped: false, newGames: newForChannel, nextIds, error: null };
    } catch (err) {
        return { skipped: false, newGames: newForChannel, nextIds: epic.lastNotifiedIds ?? [], error: err };
    }
}

function createDiscordNewsScheduler({
    GuildNotificationConfig,
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

            const configs = await GuildNotificationConfig.find({ 'epic.enabled': true });

            for (const config of configs) {
                const result = await tickGuildConfig(config, games, messenger, channelStateStore);
                if (result.skipped) continue;
                if (result.error) {
                    config.epic.lastError = result.error.message || String(result.error);
                } else {
                    config.epic.lastNotifiedIds = result.nextIds;
                    config.epic.lastNotifiedAt = new Date();
                    config.epic.lastError = null;
                }
                try {
                    await config.save();
                } catch (err) {
                    logger.error(`[DiscordNews] Could not persist state for guild ${config.guildId}:`, err.message);
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

module.exports = { tickGuildConfig, createDiscordNewsScheduler, POLL_INTERVAL_MS, EPIC_SOURCE };
