const { createNoopChannelStateStore } = require('./channelStateStore');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const GAME_UPDATES_SOURCE_PREFIX = 'steamGameUpdates';
const MAX_GIDS_PER_SUB = 50;
const NEWS_ITEMS_PER_APP = 5;

function sourceKey(appId) {
    return `${GAME_UPDATES_SOURCE_PREFIX}:${appId}`;
}

function capGids(gids, max = MAX_GIDS_PER_SUB) {
    if (gids.length <= max) return gids;
    return gids.slice(gids.length - max);
}

async function tickSubscription(sub, channelId, items, messenger, channelStateStore) {
    const previousGids = sub.lastNotifiedGids ?? [];
    if (!Array.isArray(items) || items.length === 0) {
        return { appId: sub.appId, sent: [], nextGids: previousGids, error: null };
    }

    const knownByGuild = new Set(previousGids);
    const newForGuild = items.filter((i) => !knownByGuild.has(i.gid));
    if (newForGuild.length === 0) {
        const all = items.map((i) => i.gid);
        const merged = Array.from(new Set([...previousGids, ...all]));
        return { appId: sub.appId, sent: [], nextGids: capGids(merged), error: null };
    }

    const source = sourceKey(sub.appId);
    let knownByChannel;
    try {
        knownByChannel = await channelStateStore.getKnownIds(channelId, source);
    } catch (err) {
        return { appId: sub.appId, sent: [], nextGids: previousGids, error: err };
    }

    const newForChannel = newForGuild.filter((i) => !knownByChannel.has(i.gid));
    const allGids = items.map((i) => i.gid);

    if (newForChannel.length === 0) {
        const merged = Array.from(new Set([...previousGids, ...allGids]));
        return { appId: sub.appId, sent: [], nextGids: capGids(merged), error: null };
    }

    try {
        await messenger.sendGameUpdates(channelId, {
            appId: sub.appId,
            appName: sub.name,
            items: newForChannel,
        });
        const nextChannelIds = Array.from(new Set([...knownByChannel, ...allGids]));
        await channelStateStore.recordSent(channelId, source, nextChannelIds);
        const merged = Array.from(new Set([...previousGids, ...allGids]));
        return { appId: sub.appId, sent: newForChannel, nextGids: capGids(merged), error: null };
    } catch (err) {
        return { appId: sub.appId, sent: newForChannel, nextGids: previousGids, error: err };
    }
}

async function tickGuildGameUpdates(
    config,
    itemsByAppId,
    messenger,
    channelStateStore = createNoopChannelStateStore(),
) {
    const gu = config?.gameUpdates;
    if (!gu || !gu.enabled || !gu.channelId) {
        return { skipped: true, perSub: [] };
    }
    const subs = Array.isArray(gu.subscriptions) ? gu.subscriptions : [];
    const perSub = [];
    for (const sub of subs) {
        const items = itemsByAppId.get(sub.appId) ?? itemsByAppId.get(String(sub.appId)) ?? [];
        const result = await tickSubscription(sub, gu.channelId, items, messenger, channelStateStore);
        perSub.push(result);
    }
    return { skipped: false, perSub };
}

function createSteamUpdatesScheduler({
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
        let polled = 0;
        let totalSent = 0;
        let guildsTouched = 0;
        try {
            const configs = await GuildNotificationConfig.find({ 'gameUpdates.enabled': true });
            const appIds = new Set();
            for (const cfg of configs) {
                for (const sub of cfg.gameUpdates.subscriptions ?? []) {
                    appIds.add(sub.appId);
                }
            }

            const itemsByAppId = new Map();
            for (const appId of appIds) {
                try {
                    const items = await provider.fetchLatestUpdates(appId, { limit: NEWS_ITEMS_PER_APP });
                    itemsByAppId.set(appId, items);
                    polled += 1;
                } catch (err) {
                    logger.warn(`[SteamUpdates] Provider failed for appId ${appId}: ${err.message}`);
                    itemsByAppId.set(appId, []);
                }
            }

            for (const config of configs) {
                const result = await tickGuildGameUpdates(config, itemsByAppId, messenger, channelStateStore);
                if (result.skipped) continue;
                guildsTouched += 1;

                let guildAdvanced = false;
                for (let i = 0; i < config.gameUpdates.subscriptions.length; i += 1) {
                    const sub = config.gameUpdates.subscriptions[i];
                    const subResult = result.perSub.find((r) => r.appId === sub.appId);
                    if (!subResult) continue;
                    if (subResult.error) {
                        sub.lastError = subResult.error.message || String(subResult.error);
                        continue;
                    }
                    sub.lastError = null;
                    sub.lastNotifiedGids = subResult.nextGids;
                    if (subResult.sent.length > 0) {
                        sub.lastNotifiedAt = new Date();
                        totalSent += subResult.sent.length;
                        guildAdvanced = true;
                    } else {
                        guildAdvanced = true;
                    }
                }

                if (guildAdvanced) {
                    try {
                        await config.save();
                    } catch (err) {
                        logger.error(`[SteamUpdates] Persist failed for guild ${config.guildId}: ${err.message}`);
                    }
                }
            }

            logger.info(`[SteamUpdates] Tick: ${polled} appIds polled, ${totalSent} updates sent across ${guildsTouched} guilds`);
        } catch (err) {
            logger.error('[SteamUpdates] Unexpected tick failure:', err);
        } finally {
            running = false;
        }
    }

    return {
        start() {
            if (timer) return;
            timer = setInterval(runTick, intervalMs);
            logger.info(`[SteamUpdates] Scheduler started (interval=${intervalMs}ms)`);
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

module.exports = {
    tickGuildGameUpdates,
    createSteamUpdatesScheduler,
    POLL_INTERVAL_MS,
    GAME_UPDATES_SOURCE_PREFIX,
    MAX_GIDS_PER_SUB,
    NEWS_ITEMS_PER_APP,
    sourceKey,
};
