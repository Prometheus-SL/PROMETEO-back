const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const VIOLET = 0x7c3aed;
const STEAM_BLUE = 0x1b2838;
const SPOTIFY_GREEN = 0x1db954;
const EPIC_LOGO_URL = 'https://cdn2.unrealengine.com/Epic+Games+Node%2FEGS_Horizontal_FINAL_white+logo_1900x500-1900x500-36e4c79aec80c37be1bd21e18f1eafef2bf3ef52.png';
const STEAM_LOGO_URL = 'https://store.cloudflare.steamstatic.com/public/shared/images/header/logo_steam.svg';

const DISCORD_EMBED_TITLE_MAX = 256;
const STEAM_CONTENTS_TRUNCATE_CHARS = 800;
const EMBEDS_PER_MESSAGE = 10;

function formatDateEs(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Madrid',
    }).format(date);
}

function toTitleCase(s) {
    return s.toLowerCase().replace(/\b[a-z0-9]/g, (c) => c.toUpperCase());
}

function bbcodeToMarkdown(text) {
    if (typeof text !== 'string') return '';

    let out = text.replace(/\r\n/g, '\n');

    out = out.replace(/\\\[\s*([A-Z0-9][A-Z0-9 ]*?)\s*\]/g, (_, title) => `**${toTitleCase(title.trim())}**`);

    out = out.replace(/\[img\][^\[]*\[\/img\]/gi, '');

    out = out.replace(/\[url=["']?([^"'\]]+)["']?\]([\s\S]*?)\[\/url\]/gi, '[$2]($1)');

    out = out.replace(/\[h[1-6]\]([\s\S]*?)\[\/h[1-6]\]/gi, '\n**$1**\n');
    out = out.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '**$1**');
    out = out.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '*$1*');
    out = out.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '__$1__');

    out = out.replace(/\[\/p\]\[\/\*\]/gi, '\n');

    out = out.replace(/\[\*\]/gi, '• ');
    out = out.replace(/\[\/\*\]/gi, '\n');
    out = out.replace(/\[list\]/gi, '\n');
    out = out.replace(/\[\/list\]/gi, '\n');

    out = out.replace(/\[p\]/gi, '');
    out = out.replace(/\[\/p\]/gi, '\n\n');

    out = out.replace(/\[\/?[a-z][a-z0-9]*(?:=[^\]]*|\s+[^\]]*=[^\]]*)?\]/gi, '');

    out = out.replace(/[ \t]+\n/g, '\n');
    out = out.replace(/\n[ \t]+/g, '\n');
    out = out.replace(/\n{3,}/g, '\n\n');

    return out.trim();
}

function truncate(text, max) {
    if (typeof text !== 'string') return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trimEnd()}…`;
}

function buildEpicEmbed(game) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: 'Prometeo · Epic Games', iconURL: EPIC_LOGO_URL })
        .setTitle(game.title)
        .setURL(game.storeUrl)
        .setColor(VIOLET)
        .addFields(
            { name: 'Precio',       value: `~~${game.priceOriginal || '—'}~~ **GRATIS**`, inline: true },
            { name: 'Gratis hasta', value: formatDateEs(game.freeUntil),                   inline: true },
        )
        .setFooter({ text: 'Free Game · Epic Games Store' })
        .setTimestamp();

    if (game.description) {
        embed.setDescription(game.description.slice(0, 200));
    }
    if (game.imageUrl) {
        embed.setImage(game.imageUrl);
    }
    return embed;
}

function buildEpicActionRow(games) {
    const row = new ActionRowBuilder();
    for (const game of games) {
        row.addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setURL(game.storeUrl)
                .setLabel(`Reclamar ${game.title.slice(0, 40)}`),
        );
    }
    return row;
}

function buildSteamEmbed({ appId, appName, item }) {
    const title = truncate(`${appName} — ${item.title}`, DISCORD_EMBED_TITLE_MAX);
    const body = truncate(bbcodeToMarkdown(item.contents), STEAM_CONTENTS_TRUNCATE_CHARS);
    const embed = new EmbedBuilder()
        .setAuthor({ name: 'Prometeo · Steam', iconURL: STEAM_LOGO_URL })
        .setTitle(title)
        .setURL(item.url)
        .setColor(STEAM_BLUE)
        .setThumbnail(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`)
        .setFooter({ text: `Steam · ${item.feedname}` });
    if (body) embed.setDescription(body);
    if (item.date instanceof Date && !Number.isNaN(item.date.getTime())) {
        embed.setTimestamp(item.date);
    }
    return embed;
}

function buildArtistReleaseEmbed(artistName, item) {
    const typeLabel = {
        album: 'Album',
        single: 'Single',
        compilation: 'Compilation',
        appears_on: 'Featured',
    }[item.type] || 'Release';

    const title = truncate(`${artistName} — ${item.name}`, DISCORD_EMBED_TITLE_MAX);
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setURL(item.url)
        .setColor(SPOTIFY_GREEN)
        .addFields({ name: 'Type', value: typeLabel, inline: true })
        .addFields({ name: 'Release date', value: item.releaseDate || 'N/A', inline: true })
        .setFooter({ text: 'Spotify · New release' });

    if (item.imageUrl) {
        embed.setThumbnail(item.imageUrl);
    }

    return embed;
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}

async function fetchTextChannel(client, channelId) {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
        const err = new Error(`Channel ${channelId} not found`);
        err.code = 'CHANNEL_NOT_FOUND';
        throw err;
    }
    if (channel.type !== 0) {
        const err = new Error(`Channel ${channelId} is not a text channel (type=${channel.type})`);
        err.code = 'NOT_TEXT_CHANNEL';
        throw err;
    }
    return channel;
}

function createDiscordNewsMessenger({ client }) {
    if (!client) throw new Error('createDiscordNewsMessenger: client is required');

    return {
        async sendFreeGames(channelId, games) {
            if (!Array.isArray(games) || games.length === 0) return;
            const channel = await fetchTextChannel(client, channelId);
            const embeds = games.slice(0, EMBEDS_PER_MESSAGE).map(buildEpicEmbed);
            const components = [buildEpicActionRow(games.slice(0, EMBEDS_PER_MESSAGE))];
            await channel.send({ embeds, components });
        },

        async sendGameUpdates(channelId, { appId, appName, items } = {}) {
            if (!Array.isArray(items) || items.length === 0) return;
            const channel = await fetchTextChannel(client, channelId);
            const embeds = items.map((item) => buildSteamEmbed({ appId, appName, item }));
            for (const batch of chunk(embeds, EMBEDS_PER_MESSAGE)) {
                await channel.send({ embeds: batch });
            }
        },

        async sendArtistReleases(channelId, { artistName, items } = {}) {
            if (!Array.isArray(items) || items.length === 0) return;
            const channel = await fetchTextChannel(client, channelId);
            const embeds = items.map((item) => buildArtistReleaseEmbed(artistName, item));
            for (const batch of chunk(embeds, EMBEDS_PER_MESSAGE)) {
                await channel.send({ embeds: batch });
            }
        },
    };
}

module.exports = { createDiscordNewsMessenger, bbcodeToMarkdown };
