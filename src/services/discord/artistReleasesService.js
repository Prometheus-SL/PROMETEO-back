const GuildNotificationConfig = require('../../models/GuildNotificationConfig');
const { getClient } = require('./client');
const { getUserAdminGuilds } = require('./userGuildsService');
const { createSpotifyReleasesProvider, createSpotifyTokenProvider } = require('./providers/spotifyReleases');
const { createSpotifyArtistCatalog } = require('./spotifyArtistCatalog');

const MAX_SUBS_PER_GUILD = 25;
const VALID_RELEASE_TYPES = ['album', 'single', 'compilation', 'appears_on'];

function publicSubscription(sub) {
    return {
        artistId: sub.artistId,
        name: sub.name,
        imageUrl: sub.imageUrl ?? null,
        lastNotifiedAt: sub.lastNotifiedAt ?? null,
        lastError: sub.lastError ?? null,
    };
}

function publicEntry(guildConfig) {
    const ar = guildConfig?.artistReleases ?? {};
    return {
        guildId: String(guildConfig.guildId),
        channelId: ar.channelId ?? null,
        enabled: Boolean(ar.enabled),
        includeTypes: Array.isArray(ar.includeTypes) && ar.includeTypes.length > 0
            ? ar.includeTypes
            : ['album', 'single'],
        subscriptions: Array.isArray(ar.subscriptions) ? ar.subscriptions.map(publicSubscription) : [],
        updatedBy: ar.updatedBy ? String(ar.updatedBy) : null,
        updatedAt: ar.updatedAt ? new Date(ar.updatedAt).toISOString() : null,
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
        const err = new Error('Bot not in that server');
        err.status = 400;
        throw err;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== 0) {
        const err = new Error('Selected channel is not a text channel');
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

    const guildConfigs = await Model.find({ guildId: { $in: guildIds } }).lean();
    const byGuild = new Map(guildConfigs.map((d) => [String(d.guildId), d]));

    const configs = guildIds.map((id) => {
        const guildConfig = byGuild.get(id) ?? { guildId: id };
        return publicEntry(guildConfig);
    });

    return { configs, needsLink: false, needsReauth: false };
}

async function saveStatusForUser(
    userId,
    incomingConfigs,
    {
        Model = GuildNotificationConfig,
        catalog = null,
        provider = null,
    } = {},
) {
    const { needsLink, needsReauth, guilds } = await getUserAdminGuilds(userId);
    if (needsLink) {
        const err = new Error('Discord not linked');
        err.status = 400;
        throw err;
    }
    if (needsReauth) {
        const err = new Error('Relink Discord to grant server access');
        err.status = 400;
        throw err;
    }

    if (!catalog && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
        const tokenProvider = createSpotifyTokenProvider({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        });
        const providerInstance = createSpotifyReleasesProvider({ tokenProvider });
        catalog = createSpotifyArtistCatalog({ provider: providerInstance });
        provider = providerInstance;
    }

    if (!catalog || !provider) {
        const err = new Error('Spotify not configured');
        err.status = 503;
        throw err;
    }

    const allowedGuildIds = new Set(guilds.map((g) => g.id));

    for (const raw of Array.isArray(incomingConfigs) ? incomingConfigs : []) {
        const guildId = String(raw?.guildId ?? '');
        if (!guildId) {
            const err = new Error('Each config requires guildId');
            err.status = 400;
            throw err;
        }
        if (!allowedGuildIds.has(guildId)) {
            const err = new Error(`Not admin/owner of guild ${guildId}`);
            err.status = 403;
            throw err;
        }

        let includeTypes = Array.isArray(raw?.includeTypes) ? raw.includeTypes : [];
        includeTypes = includeTypes.filter((t) => VALID_RELEASE_TYPES.includes(t));
        if (includeTypes.length === 0) {
            const err = new Error('At least one release type must be selected');
            err.status = 400;
            throw err;
        }

        const rawSubs = Array.isArray(raw?.subscriptions) ? raw.subscriptions : [];
        const seen = new Set();
        const artistIds = [];
        for (const s of rawSubs) {
            const artistId = String(s?.artistId ?? '').trim();
            if (!artistId || seen.has(artistId)) continue;
            seen.add(artistId);
            artistIds.push(artistId);
        }

        if (artistIds.length > MAX_SUBS_PER_GUILD) {
            const err = new Error(`Max ${MAX_SUBS_PER_GUILD} artists per server`);
            err.status = 400;
            throw err;
        }

        const resolvedArtists = await Promise.all(
            artistIds.map(async (artistId) => {
                const artist = await catalog.getArtist(artistId);
                return { artistId, artist };
            }),
        );

        for (const { artistId, artist } of resolvedArtists) {
            if (!artist) {
                const err = new Error(`Artist ${artistId} not found on Spotify`);
                err.status = 400;
                throw err;
            }
        }

        if (raw?.enabled) {
            if (!raw?.channelId) {
                const err = new Error('channelId required to enable artist releases');
                err.status = 400;
                throw err;
            }
            await validateTextChannel({ guildId, channelId: raw.channelId });
        }

        const existing = await Model.findOne({ guildId }).lean();
        const previousSubs = new Map(
            (existing?.artistReleases?.subscriptions ?? []).map((s) => [s.artistId, s]),
        );

        const subscriptions = resolvedArtists.map(({ artistId, artist }) => {
            const prev = previousSubs.get(artistId);
            return {
                artistId,
                name: artist.name,
                imageUrl: artist.imageUrl ?? null,
                lastNotifiedIds: prev?.lastNotifiedIds ?? [],
                lastNotifiedAt: prev?.lastNotifiedAt ?? null,
                lastError: prev?.lastError ?? null,
            };
        });

        await Model.findOneAndUpdate(
            { guildId },
            {
                guildId,
                artistReleases: {
                    enabled: Boolean(raw?.enabled),
                    channelId: raw?.enabled ? String(raw.channelId) : (raw?.channelId ?? null),
                    includeTypes,
                    subscriptions,
                    updatedBy: userId,
                    updatedAt: new Date(),
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
    }

    return getStatusForUser(userId, { Model });
}

async function listEnabledConfigs({ Model = GuildNotificationConfig } = {}) {
    return Model.find({ 'artistReleases.enabled': true });
}

module.exports = {
    getStatusForUser,
    saveStatusForUser,
    listEnabledConfigs,
    publicEntry,
    MAX_SUBS_PER_GUILD,
};
