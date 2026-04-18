const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../src/models/User');
const GuildNotificationConfig = require('../src/models/GuildNotificationConfig');

function normalizeEntry(raw) {
    return {
        guildId: String(raw?.guildId ?? ''),
        channelId: raw?.channelId ? String(raw.channelId) : null,
        enabled: Boolean(raw?.enabled),
        lastNotifiedIds: Array.isArray(raw?.lastNotifiedIds) ? raw.lastNotifiedIds : [],
        lastNotifiedAt: raw?.lastNotifiedAt ? new Date(raw.lastNotifiedAt) : null,
        lastError: raw?.lastError ?? null,
    };
}

function readEntries(user) {
    const raw = user?.linkedAccounts?.discord?.notifications?.epicFreeGames;
    if (Array.isArray(raw)) return raw.map(normalizeEntry);
    if (raw && typeof raw === 'object' && raw.guildId) return [normalizeEntry(raw)];
    return [];
}

function recencyScore(entry, userUpdatedAt) {
    return (
        entry.lastNotifiedAt?.getTime() ??
        (userUpdatedAt ? new Date(userUpdatedAt).getTime() : 0)
    );
}

async function run() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI no configurado');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Conectado a MongoDB');

    const users = await User.find({
        'linkedAccounts.discord.notifications.epicFreeGames': { $exists: true },
    });
    console.log(`${users.length} usuarios con configs Epic`);

    // Group by guildId, keep most recent
    const byGuild = new Map();
    for (const user of users) {
        const entries = readEntries(user);
        for (const entry of entries) {
            if (!entry.guildId) continue;
            const score = recencyScore(entry, user.updatedAt);
            const existing = byGuild.get(entry.guildId);
            if (!existing || score > existing.score) {
                byGuild.set(entry.guildId, {
                    entry,
                    score,
                    userId: user._id,
                });
            }
        }
    }

    console.log(`${byGuild.size} guilds a migrar`);

    let created = 0;
    let updated = 0;
    for (const { entry, userId } of byGuild.values()) {
        const existing = await GuildNotificationConfig.findOne({ guildId: entry.guildId });
        const epic = {
            enabled: entry.enabled,
            channelId: entry.channelId,
            lastNotifiedIds: entry.lastNotifiedIds,
            lastNotifiedAt: entry.lastNotifiedAt,
            lastError: entry.lastError,
            updatedBy: userId,
            updatedAt: new Date(),
        };
        if (existing) {
            existing.epic = epic;
            await existing.save();
            updated += 1;
        } else {
            await GuildNotificationConfig.create({ guildId: entry.guildId, epic });
            created += 1;
        }
        console.log(` → guild ${entry.guildId}: enabled=${entry.enabled} channel=${entry.channelId}`);
    }

    console.log(`Listo. creados=${created} actualizados=${updated}`);

    // Optionally clear the old per-user data so it doesn't linger
    const clearResult = await User.updateMany(
        { 'linkedAccounts.discord.notifications.epicFreeGames': { $exists: true } },
        { $unset: { 'linkedAccounts.discord.notifications': '' } },
    );
    console.log(`Limpiados ${clearResult.modifiedCount} users (user.linkedAccounts.discord.notifications eliminado)`);

    await mongoose.disconnect();
    process.exit(0);
}

run().catch((err) => {
    console.error('Migración falló:', err);
    process.exit(1);
});
