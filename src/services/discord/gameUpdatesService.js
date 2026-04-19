const GuildNotificationConfig = require('../../models/GuildNotificationConfig');
const { getClient } = require('./client');
const { getUserAdminGuilds } = require('./userGuildsService');
const { getSharedCatalog } = require('./steamCatalog');
const { createSteamNewsProvider } = require('./providers/steamNews');

const MAX_SUBS_PER_GUILD = 25;

function publicSub(sub) {
    return {
        appId: sub.appId,
        name: sub.name,
        lastNotifiedAt: sub.lastNotifiedAt ?? null,
        lastError: sub.lastError ?? null,
    };
}

function publicEntry(doc) {
    const gu = doc?.gameUpdates ?? {};
    return {
        guildId: String(doc.guildId),
        channelId: gu.channelId ?? null,
        enabled: Boolean(gu.enabled),
        subscriptions: Array.isArray(gu.subscriptions) ? gu.subscriptions.map(publicSub) : [],
        updatedBy: gu.updatedBy ? String(gu.updatedBy) : null,
        updatedAt: gu.updatedAt ?? null,
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
    const byGuild = new Map(docs.map((d) => [String(d.guildId), d]));
    const configs = guildIds.map((id) => publicEntry(byGuild.get(id) ?? { guildId: id }));
    return { configs, needsLink: false, needsReauth: false };
}

async function saveStatusForUser(
    userId,
    incomingConfigs,
    {
        Model = GuildNotificationConfig,
        catalog = getSharedCatalog(),
        provider = createSteamNewsProvider(),
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
        const rawSubs = Array.isArray(raw?.subscriptions) ? raw.subscriptions : [];
        const seen = new Set();
        const subs = [];
        for (const s of rawSubs) {
            const appId = Number(s?.appId);
            if (!Number.isFinite(appId) || seen.has(appId)) continue;
            seen.add(appId);
            subs.push({ appId });
        }
        if (subs.length > MAX_SUBS_PER_GUILD) {
            const err = new Error(`Máximo ${MAX_SUBS_PER_GUILD} juegos por servidor`);
            err.status = 400;
            throw err;
        }
        byGuild.set(guildId, {
            guildId,
            channelId: raw?.channelId ? String(raw.channelId) : null,
            enabled: Boolean(raw?.enabled),
            subscriptions: subs,
        });
    }

    const incoming = Array.from(byGuild.values());

    for (const entry of incoming) {
        for (const sub of entry.subscriptions) {
            const resolvedName = await catalog.getName(sub.appId);
            if (resolvedName == null) {
                const err = new Error(`appId ${sub.appId} no existe en el catálogo de Steam`);
                err.status = 400;
                throw err;
            }
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

    const now = new Date();
    const warnings = [];

    for (const entry of incoming) {
        const prev = await Model.findOne({ guildId: entry.guildId });
        const prevSubs = Array.isArray(prev?.gameUpdates?.subscriptions)
            ? prev.gameUpdates.subscriptions
            : [];
        const prevByAppId = new Map(prevSubs.map((s) => [s.appId, s]));

        const nextSubs = [];
        for (const incomingSub of entry.subscriptions) {
            const existing = prevByAppId.get(incomingSub.appId);
            if (existing) {
                const fallback = existing.name || (await catalog.getName(existing.appId)) || String(existing.appId);
                nextSubs.push({
                    appId: existing.appId,
                    name: fallback,
                    lastNotifiedGids: existing.lastNotifiedGids ?? [],
                    lastNotifiedAt: existing.lastNotifiedAt ?? null,
                    lastError: existing.lastError ?? null,
                });
                continue;
            }
            const name = (await catalog.getName(incomingSub.appId)) ?? String(incomingSub.appId);
            let seedGids = [];
            try {
                const items = await provider.fetchLatestUpdates(incomingSub.appId, { limit: 5 });
                seedGids = items.map((i) => i.gid);
            } catch (err) {
                warnings.push(`${entry.guildId}/${incomingSub.appId}: ${err.message}`);
            }
            nextSubs.push({
                appId: incomingSub.appId,
                name,
                lastNotifiedGids: seedGids,
                lastNotifiedAt: seedGids.length > 0 ? now : null,
                lastError: null,
            });
        }

        const nextGameUpdates = {
            enabled: entry.enabled,
            channelId: entry.enabled ? entry.channelId : (entry.channelId ?? prev?.gameUpdates?.channelId ?? null),
            subscriptions: nextSubs,
            updatedBy: userId,
            updatedAt: now,
        };

        await Model.findOneAndUpdate(
            { guildId: entry.guildId },
            { guildId: entry.guildId, gameUpdates: nextGameUpdates },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
    }

    const guildIds = guilds.map((g) => g.id);
    const docs = await Model.find({ guildId: { $in: guildIds } }).lean();
    const byId = new Map(docs.map((d) => [String(d.guildId), d]));
    const configs = guildIds.map((id) => publicEntry(byId.get(id) ?? { guildId: id }));
    return { configs, warning: warnings.length ? warnings.join('; ') : null };
}

async function listEnabledConfigs({ Model = GuildNotificationConfig } = {}) {
    return Model.find({ 'gameUpdates.enabled': true });
}

module.exports = {
    getStatusForUser,
    saveStatusForUser,
    listEnabledConfigs,
    publicEntry,
    MAX_SUBS_PER_GUILD,
};
