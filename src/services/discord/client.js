const { Client, GatewayIntentBits } = require('discord.js');

let client = null;
let ready = false;
let initPromise = null;

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
            ],
        });

        client.on('error', (err) => {
            console.error('[Discord] Error:', err.message);
        });

        await client.login(token);

        await new Promise((resolve, reject) => {
            if (client.isReady()) {
                ready = true;
                resolve();
                return;
            }
            client.once('ready', () => {
                ready = true;
                console.log(`[Discord] Bot conectado como ${client.user.tag}`);
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

    // Fetch members to get presence data
    try {
        await guild.members.fetch({ withPresences: true, time: 10000 });
    } catch (err) {
        console.warn('[Discord] No se pudieron cargar todos los miembros, usando cache:', err.message);
    }

    const channels = guild.channels.cache
        .filter(ch => ch.type === 0 || ch.type === 2) // text or voice
        .sort((a, b) => a.position - b.position)
        .map(ch => ({
            id: ch.id,
            name: ch.name,
            type: ch.type === 0 ? 'text' : 'voice',
            members: ch.type === 2 ? ch.members.size : undefined,
        }));

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
    // Permissions: View Channels, Read Message History
    const permissions = 1024 + 65536;
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot`;
}

module.exports = { initBot, getClient, getStatus, getGuildInfo, getInviteUrl };
