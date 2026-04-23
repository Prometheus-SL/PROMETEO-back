const { createNoopChannelStateStore } = require('./channelStateStore');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ARTIST_RELEASES_SOURCE_PREFIX = 'artistReleases';
const MAX_IDS_PER_SUBSCRIPTION = 50;
const RELEASES_PER_ARTIST = 10;

function sourceKey(artistId) {
    return `${ARTIST_RELEASES_SOURCE_PREFIX}:${artistId}`;
}

function capIds(ids, max = MAX_IDS_PER_SUBSCRIPTION) {
    if (ids.length <= max) return ids;
    return ids.slice(ids.length - max);
}

async function tickGuildArtistReleases(
    config,
    releasesByKey,
    messenger,
    channelStateStore = createNoopChannelStateStore(),
) {
    const ar = config?.artistReleases;
    if (!ar || !ar.enabled || !ar.channelId) {
        return { skipped: true, perArtist: [] };
    }

    const subscriptions = Array.isArray(ar.subscriptions) ? ar.subscriptions : [];
    if (subscriptions.length === 0) {
        return { skipped: false, perArtist: [] };
    }

    const perArtist = [];

    for (const sub of subscriptions) {
        const artistId = sub.artistId;
        const items = releasesByKey.get(sourceKey(artistId)) ?? [];

        if (!Array.isArray(items) || items.length === 0) {
            perArtist.push({
                artistId,
                sent: [],
                nextState: {
                    artistId,
                    name: sub.name,
                    imageUrl: sub.imageUrl ?? null,
                    lastNotifiedIds: sub.lastNotifiedIds ?? [],
                    lastNotifiedAt: sub.lastNotifiedAt ?? null,
                    lastError: sub.lastError ?? null,
                },
                changed: false,
                error: null,
            });
            continue;
        }

        const knownByGuild = new Set(sub.lastNotifiedIds ?? []);
        const allIds = items.map((i) => i.id);
        const newForGuild = items.filter((i) => !knownByGuild.has(i.id));

        if (newForGuild.length === 0) {
            const merged = Array.from(new Set([...(sub.lastNotifiedIds ?? []), ...allIds]));
            const capped = capIds(merged);
            const changed = capped.length !== (sub.lastNotifiedIds ?? []).length
                || capped.some((id, idx) => (sub.lastNotifiedIds ?? [])[idx] !== id);
            perArtist.push({
                artistId,
                sent: [],
                nextState: {
                    artistId,
                    name: sub.name,
                    imageUrl: sub.imageUrl ?? null,
                    lastNotifiedIds: capped,
                    lastNotifiedAt: sub.lastNotifiedAt ?? null,
                    lastError: null,
                },
                changed,
                error: null,
            });
            continue;
        }

        let knownByChannel;
        try {
            knownByChannel = await channelStateStore.getKnownIds(ar.channelId, sourceKey(artistId));
        } catch (err) {
            perArtist.push({
                artistId,
                sent: [],
                nextState: {
                    artistId,
                    name: sub.name,
                    imageUrl: sub.imageUrl ?? null,
                    lastNotifiedIds: sub.lastNotifiedIds ?? [],
                    lastNotifiedAt: sub.lastNotifiedAt ?? null,
                    lastError: err.message || String(err),
                },
                changed: true,
                error: err,
            });
            continue;
        }

        const newForChannel = newForGuild.filter((i) => !knownByChannel.has(i.id));

        if (newForChannel.length === 0) {
            const merged = Array.from(new Set([...(sub.lastNotifiedIds ?? []), ...allIds]));
            perArtist.push({
                artistId,
                sent: [],
                nextState: {
                    artistId,
                    name: sub.name,
                    imageUrl: sub.imageUrl ?? null,
                    lastNotifiedIds: capIds(merged),
                    lastNotifiedAt: sub.lastNotifiedAt ?? null,
                    lastError: null,
                },
                changed: true,
                error: null,
            });
            continue;
        }

        const sortedNew = [...newForChannel].sort((a, b) => {
            const da = a.releaseDate || '';
            const db = b.releaseDate || '';
            return db.localeCompare(da);
        });
        const latest = sortedNew[0];

        try {
            await messenger.sendArtistReleases(ar.channelId, {
                artistName: sub.name,
                items: [latest],
            });
            const nextChannelIds = Array.from(new Set([...knownByChannel, ...allIds]));
            await channelStateStore.recordSent(ar.channelId, sourceKey(artistId), nextChannelIds);
            const merged = Array.from(new Set([...(sub.lastNotifiedIds ?? []), ...allIds]));
            perArtist.push({
                artistId,
                sent: [latest],
                nextState: {
                    artistId,
                    name: sub.name,
                    imageUrl: sub.imageUrl ?? null,
                    lastNotifiedIds: capIds(merged),
                    lastNotifiedAt: new Date(),
                    lastError: null,
                },
                changed: true,
                error: null,
            });
        } catch (err) {
            perArtist.push({
                artistId,
                sent: [latest],
                nextState: {
                    artistId,
                    name: sub.name,
                    imageUrl: sub.imageUrl ?? null,
                    lastNotifiedIds: sub.lastNotifiedIds ?? [],
                    lastNotifiedAt: sub.lastNotifiedAt ?? null,
                    lastError: err.message || String(err),
                },
                changed: true,
                error: err,
            });
        }
    }

    return { skipped: false, perArtist };
}

function createArtistReleasesScheduler({
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
            const enabledConfigs = await GuildNotificationConfig.find({ 'artistReleases.enabled': true });

            const includeTypesByArtist = new Map();
            for (const config of enabledConfigs) {
                const ar = config.artistReleases;
                const includeTypes = Array.isArray(ar?.includeTypes) && ar.includeTypes.length > 0
                    ? ar.includeTypes
                    : ['album', 'single'];
                for (const sub of ar?.subscriptions ?? []) {
                    const existing = includeTypesByArtist.get(sub.artistId);
                    if (!existing) {
                        includeTypesByArtist.set(sub.artistId, new Set(includeTypes));
                    } else {
                        for (const t of includeTypes) existing.add(t);
                    }
                }
            }

            const releasesByKey = new Map();
            for (const [artistId, typesSet] of includeTypesByArtist) {
                try {
                    const releases = await provider.fetchLatestReleases(artistId, {
                        limit: RELEASES_PER_ARTIST,
                        includeGroups: Array.from(typesSet),
                    });
                    releasesByKey.set(sourceKey(artistId), releases);
                    polled += 1;
                } catch (err) {
                    logger.warn(`[ArtistReleases] Provider failed for artistId ${artistId}: ${err.message}`);
                    releasesByKey.set(sourceKey(artistId), []);
                }
            }

            for (const config of enabledConfigs) {
                const result = await tickGuildArtistReleases(config, releasesByKey, messenger, channelStateStore);
                if (result.skipped) continue;
                guildsTouched += 1;

                const anyChanged = result.perArtist.some((r) => r.changed);
                if (!anyChanged) continue;

                const nextSubs = (config.artistReleases.subscriptions ?? []).map((sub) => {
                    const match = result.perArtist.find((r) => r.artistId === sub.artistId);
                    if (!match) {
                        return {
                            artistId: sub.artistId,
                            name: sub.name,
                            imageUrl: sub.imageUrl ?? null,
                            lastNotifiedIds: sub.lastNotifiedIds ?? [],
                            lastNotifiedAt: sub.lastNotifiedAt ?? null,
                            lastError: sub.lastError ?? null,
                        };
                    }
                    return {
                        artistId: match.nextState.artistId,
                        name: match.nextState.name,
                        imageUrl: match.nextState.imageUrl,
                        lastNotifiedIds: match.nextState.lastNotifiedIds,
                        lastNotifiedAt: match.nextState.lastNotifiedAt,
                        lastError: match.nextState.lastError,
                    };
                });

                for (const r of result.perArtist) {
                    if (r.sent.length > 0) {
                        totalSent += r.sent.length;
                    }
                }

                try {
                    await GuildNotificationConfig.updateOne(
                        { guildId: config.guildId },
                        { $set: { 'artistReleases.subscriptions': nextSubs } },
                    );
                } catch (err) {
                    logger.error(
                        `[ArtistReleases] Persist failed for guild ${config.guildId}: ${err.message}`,
                    );
                }
            }

            logger.info(
                `[ArtistReleases] Tick: ${polled} artists polled, ${totalSent} releases sent across ${guildsTouched} guilds`,
            );
        } catch (err) {
            logger.error('[ArtistReleases] Unexpected tick failure:', err);
        } finally {
            running = false;
        }
    }

    return {
        start() {
            if (timer) return;
            timer = setInterval(runTick, intervalMs);
            logger.info(`[ArtistReleases] Scheduler started (interval=${intervalMs}ms)`);
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
    tickGuildArtistReleases,
    createArtistReleasesScheduler,
    POLL_INTERVAL_MS,
    ARTIST_RELEASES_SOURCE_PREFIX,
    MAX_IDS_PER_SUBSCRIPTION,
    RELEASES_PER_ARTIST,
    sourceKey,
};
