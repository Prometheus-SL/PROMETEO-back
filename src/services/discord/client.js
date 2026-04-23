const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const GuildNotificationConfig = require('../../models/GuildNotificationConfig');
const { createEpicFreeGamesProvider } = require('./providers/epicFreeGames');
const { createDiscordNewsMessenger } = require('./newsMessenger');
const { createDiscordNewsScheduler } = require('./newsScheduler');
const { createChannelStateStore } = require('./channelStateStore');
const { createSteamUpdatesScheduler } = require('./steamUpdatesScheduler');
const { createSteamNewsProvider } = require('./providers/steamNews');
const { getSharedCatalog } = require('./steamCatalog');
const { createArtistReleasesScheduler } = require('./artistReleasesScheduler');
const { createSpotifyTokenProvider, createSpotifyReleasesProvider } = require('./providers/spotifyReleases');
const { createSpotifyArtistCatalog } = require('./spotifyArtistCatalog');

let client = null;
let ready = false;
let initPromise = null;
let scheduler = null;
let steamScheduler = null;
let steamCatalogInstance = null;
let artistReleasesScheduler = null;

function startNewsSchedulerIfNeeded(botClient) {
    if (!scheduler) {
        try {
            scheduler = createDiscordNewsScheduler({
                GuildNotificationConfig,
                provider: createEpicFreeGamesProvider(),
                messenger: createDiscordNewsMessenger({ client: botClient }),
                channelStateStore: createChannelStateStore(),
            });
            scheduler.start();
            console.log('[Discord] News scheduler arrancado (tick cada 1 h)');
        } catch (err) {
            console.error('[Discord] No se pudo arrancar el news scheduler:', err.message);
        }
    }

    if (steamScheduler) return;
    try {
        steamCatalogInstance = getSharedCatalog();
        steamCatalogInstance.start();

        steamScheduler = createSteamUpdatesScheduler({
            GuildNotificationConfig,
            provider: createSteamNewsProvider(),
            messenger: createDiscordNewsMessenger({ client: botClient }),
            channelStateStore: createChannelStateStore(),
        });
        steamScheduler.start();
        console.log('[Discord] Steam updates scheduler arrancado (tick cada 1 h)');
    } catch (err) {
        console.error('[Discord] No se pudo arrancar el Steam updates scheduler:', err.message);
    }

    if (artistReleasesScheduler) return;
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        console.log('[Discord] Artist releases scheduler idle: Spotify not configured');
        return;
    }

    try {
        const spotifyTokenProvider = createSpotifyTokenProvider({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        });
        const spotifyProvider = createSpotifyReleasesProvider({ tokenProvider: spotifyTokenProvider });
        const spotifyCatalog = createSpotifyArtistCatalog({ provider: spotifyProvider });

        artistReleasesScheduler = createArtistReleasesScheduler({
            GuildNotificationConfig,
            provider: spotifyProvider,
            messenger: createDiscordNewsMessenger({ client: botClient }),
            channelStateStore: createChannelStateStore(),
        });
        artistReleasesScheduler.start();
        console.log('[Discord] Artist releases scheduler started (tick every 1 h)');
    } catch (err) {
        console.error('[Discord] Could not start artist releases scheduler:', err.message);
    }
}

function getClient() {
    if (client && ready) return client;
    return null;
}

async function initBot() {
    // Si ya está listo, devolver directamente
    if (client && ready) return client;

    // Si ya hay un intento en curso, esperar a que termine
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const token = process.env.DISCORD_BOT_TOKEN;
        if (!token) {
            throw new Error('DISCORD_BOT_TOKEN no está configurado en .env');
        }

        client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildVoiceStates,
            ],
        });

        client.on('error', (err) => {
            console.error('[Discord] Error:', err.message);
        });

        await client.login(token);

        await new Promise((resolve, reject) => {
            if (client.isReady()) {
                ready = true;
                startNewsSchedulerIfNeeded(client);
                resolve();
                return;
            }
            client.once('ready', () => {
                ready = true;
                console.log(`[Discord] Bot conectado como ${client.user.tag}`);
                startNewsSchedulerIfNeeded(client);
                resolve();
            });
            setTimeout(() => reject(new Error('Timeout esperando al bot de Discord')), 30000);
        });

        return client;
    })().catch((err) => {
        // Limpiar estado para permitir reintentos
        initPromise = null;
        client = null;
        ready = false;
        throw err;
    });

    return initPromise;
}

function getStatus() {
    if (!client || !ready) {
        return { connected: false, user: null, guilds: [] };
    }
    return {
        connected: true,
        user: {
            id: client.user.id,
            tag: client.user.tag,
            avatar: client.user.displayAvatarURL({ size: 128 }),
        },
        guilds: client.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 128 }),
            memberCount: g.memberCount,
        })),
    };
}

async function getGuildInfo(guildId) {
    const bot = getClient();
    if (!bot) throw Object.assign(new Error('Bot no conectado'), { code: 'BOT_NOT_READY' });

    const guild = bot.guilds.cache.get(guildId);
    if (!guild) throw Object.assign(new Error('El bot no está en ese servidor'), { status: 404 });

    // Populate member cache once; subsequent presence updates arrive via gateway events
    if (guild.members.cache.size < guild.memberCount) {
        try {
            await guild.members.fetch({ withPresences: true, time: 10000 });
        } catch (err) {
            console.warn('[Discord] No se pudieron cargar todos los miembros, usando cache:', err.message);
        }
    }

    const channels = guild.channels.cache
        .filter(ch => ch.type === 0 || ch.type === 2) // text or voice
        .sort((a, b) => a.position - b.position)
        .map(ch => {
            if (ch.type !== 2) {
                return { id: ch.id, name: ch.name, type: 'text' };
            }
            const voiceMembers = ch.members.map(m => ({
                id: m.id,
                name: m.displayName,
                avatar: m.displayAvatarURL({ size: 64 }),
                muted: Boolean(m.voice?.mute || m.voice?.selfMute),
                deafened: Boolean(m.voice?.deaf || m.voice?.selfDeaf),
                streaming: Boolean(m.voice?.streaming),
                video: Boolean(m.voice?.selfVideo),
            }));
            return {
                id: ch.id,
                name: ch.name,
                type: 'voice',
                members: voiceMembers.length,
                voiceMembers,
            };
        });

    const members = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => ({
            id: m.id,
            name: m.displayName,
            avatar: m.displayAvatarURL({ size: 64 }),
            status: m.presence?.status ?? 'offline',
        }))
        .sort((a, b) => {
            const order = { online: 0, idle: 1, dnd: 2, offline: 3 };
            return (order[a.status] ?? 4) - (order[b.status] ?? 4);
        });

    return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        memberCount: guild.memberCount,
        channels,
        members,
    };
}

function getInviteUrl() {
    if (!client) return null;
    const clientId = client.user?.id || process.env.DISCORD_CLIENT_ID;
    if (!clientId) return null;
    // View Channels (1024) + Read Message History (65536) + Move Members (16777216)
    const permissions = 1024 + 65536 + 16777216;
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot`;
}

async function disconnectVoiceMember(guildId, userId) {
    const bot = getClient();
    if (!bot) throw Object.assign(new Error('Bot no conectado'), { code: 'BOT_NOT_READY' });

    let guild = bot.guilds.cache.get(guildId);
    if (!guild) throw Object.assign(new Error('El bot no está en ese servidor'), { status: 404 });

    // Forzar refresco del guild (ownerId puede estar cacheado obsoleto)
    try {
        guild = await guild.fetch();
    } catch (err) {
        console.warn('[Discord] No se pudo refrescar guild:', err.message);
    }

    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member) throw Object.assign(new Error('Miembro no encontrado'), { status: 404 });

    if (!member.voice?.channelId) {
        throw Object.assign(new Error('El miembro no está en un canal de voz'), { status: 409 });
    }

    const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!botMember) {
        throw Object.assign(new Error('El bot no está presente como miembro'), { status: 500 });
    }

    console.log('[Discord] disconnect attempt', {
        guildId: guild.id,
        guildOwnerId: guild.ownerId,
        targetId: member.id,
        targetName: member.displayName,
        targetHighestRole: `${member.roles.highest.name}@${member.roles.highest.position}`,
        botId: botMember.id,
        botHighestRole: `${botMember.roles.highest.name}@${botMember.roles.highest.position}`,
        isOwner: member.id === guild.ownerId,
    });

    // Pre-checks para dar mensajes claros en vez de un 403 genérico de Discord
    if (member.id === guild.ownerId) {
        throw Object.assign(
            new Error('No se puede desconectar al dueño del servidor'),
            { status: 403 },
        );
    }

    if (botMember.roles.highest.position <= member.roles.highest.position) {
        throw Object.assign(
            new Error(
                `Jerarquía insuficiente. Bot: ${botMember.roles.highest.name} (pos ${botMember.roles.highest.position}) · Target: ${member.roles.highest.name} (pos ${member.roles.highest.position}).`,
            ),
            { status: 403 },
        );
    }

    try {
        await member.voice.disconnect('Expulsado desde el widget Prometeo');
    } catch (err) {
        const status = err?.status ?? err?.httpStatus ?? 500;
        const code = err?.code;
        throw Object.assign(
            new Error(`Discord rechazó la acción (${code ?? status}): ${err?.message ?? 'sin detalles'}`),
            { status },
        );
    }

    return { id: member.id, name: member.displayName };
}

async function setVoiceMute(guildId, userId, mute) {
    const bot = getClient();
    if (!bot) throw Object.assign(new Error('Bot no conectado'), { code: 'BOT_NOT_READY' });

    let guild = bot.guilds.cache.get(guildId);
    if (!guild) throw Object.assign(new Error('El bot no está en ese servidor'), { status: 404 });

    try {
        guild = await guild.fetch();
    } catch (err) {
        console.warn('[Discord] No se pudo refrescar guild:', err.message);
    }

    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member) throw Object.assign(new Error('Miembro no encontrado'), { status: 404 });

    if (!member.voice?.channelId) {
        throw Object.assign(new Error('El miembro no está en un canal de voz'), { status: 409 });
    }

    const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!botMember) {
        throw Object.assign(new Error('El bot no está presente como miembro'), { status: 500 });
    }

    if (member.id === guild.ownerId) {
        throw Object.assign(
            new Error('No se puede mutear al dueño del servidor'),
            { status: 403 },
        );
    }

    if (botMember.roles.highest.position <= member.roles.highest.position) {
        throw Object.assign(
            new Error(
                `Jerarquía insuficiente. Bot: ${botMember.roles.highest.name} (pos ${botMember.roles.highest.position}) · Target: ${member.roles.highest.name} (pos ${member.roles.highest.position}).`,
            ),
            { status: 403 },
        );
    }

    try {
        await member.voice.setMute(Boolean(mute), mute ? 'Muteado desde el widget Prometeo' : 'Desmuteado desde el widget Prometeo');
    } catch (err) {
        const status = err?.status ?? err?.httpStatus ?? 500;
        const code = err?.code;
        throw Object.assign(
            new Error(`Discord rechazó la acción (${code ?? status}): ${err?.message ?? 'sin detalles'}`),
            { status },
        );
    }

    return { id: member.id, name: member.displayName, muted: Boolean(mute) };
}

async function getMemberPermissions(guildId, discordUserId) {
    if (!discordUserId) {
        return { isAdmin: false, isOwner: false, hasLinkedDiscord: false };
    }

    const bot = getClient();
    if (!bot) throw Object.assign(new Error('Bot no conectado'), { code: 'BOT_NOT_READY' });

    let guild = bot.guilds.cache.get(guildId);
    if (!guild) throw Object.assign(new Error('El bot no está en ese servidor'), { status: 404 });

    try {
        guild = await guild.fetch();
    } catch (_err) {
        // Fall back to cached guild; ownerId may be slightly stale but acceptable for this check.
    }

    let member;
    try {
        member = await guild.members.fetch({ user: discordUserId });
    } catch (_err) {
        return { isAdmin: false, isOwner: false, hasLinkedDiscord: true };
    }

    const isOwner = member.id === guild.ownerId;
    const isAdmin = Boolean(member.permissions?.has?.(PermissionsBitField.Flags.Administrator));

    return { isAdmin, isOwner, hasLinkedDiscord: true };
}

function __setClientForTests(fakeClient) {
    client = fakeClient;
    ready = Boolean(fakeClient);
}

module.exports = {
    initBot,
    getClient,
    getStatus,
    getGuildInfo,
    getInviteUrl,
    disconnectVoiceMember,
    setVoiceMute,
    getMemberPermissions,
    __setClientForTests,
};
