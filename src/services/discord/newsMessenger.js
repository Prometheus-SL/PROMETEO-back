const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const VIOLET = 0x7c3aed;
const EPIC_LOGO_URL = 'https://cdn2.unrealengine.com/Epic+Games+Node%2FEGS_Horizontal_FINAL_white+logo_1900x500-1900x500-36e4c79aec80c37be1bd21e18f1eafef2bf3ef52.png';

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

function buildEmbed(game) {
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

function buildActionRow(games) {
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

function createDiscordNewsMessenger({ client }) {
    if (!client) throw new Error('createDiscordNewsMessenger: client is required');

    return {
        async sendFreeGames(channelId, games) {
            if (!Array.isArray(games) || games.length === 0) return;

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

            const embeds = games.slice(0, 10).map(buildEmbed);
            const components = [buildActionRow(games.slice(0, 10))];

            await channel.send({ embeds, components });
        },
    };
}

module.exports = { createDiscordNewsMessenger };
