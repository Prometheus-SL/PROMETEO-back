const mongoose = require('mongoose');

const epicConfigSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        lastNotifiedIds: { type: [String], default: [] },
        lastNotifiedAt: { type: Date, default: null },
        lastError: { type: String, default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        updatedAt: { type: Date, default: null },
    },
    { _id: false },
);

const gameUpdateSubscriptionSchema = new mongoose.Schema(
    {
        appId: { type: Number, required: true },
        name: { type: String, required: true },
        lastNotifiedGids: { type: [String], default: [] },
        lastNotifiedAt: { type: Date, default: null },
        lastError: { type: String, default: null },
    },
    { _id: false },
);

const gameUpdatesConfigSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        subscriptions: {
            type: [gameUpdateSubscriptionSchema],
            default: [],
            validate: [
                (v) => !Array.isArray(v) || v.length <= 25,
                'Max 25 juegos por servidor',
            ],
        },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        updatedAt: { type: Date, default: null },
    },
    { _id: false },
);

const artistSubscriptionSchema = new mongoose.Schema(
    {
        artistId: { type: String, required: true },
        name: { type: String, required: true },
        imageUrl: { type: String, default: null },
        lastNotifiedIds: { type: [String], default: [] },
        lastNotifiedAt: { type: Date, default: null },
        lastError: { type: String, default: null },
    },
    { _id: false },
);

const artistReleasesConfigSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        includeTypes: {
            type: [String],
            enum: ['album', 'single', 'compilation', 'appears_on'],
            default: ['album', 'single'],
        },
        subscriptions: {
            type: [artistSubscriptionSchema],
            default: [],
            validate: [
                (v) => !Array.isArray(v) || v.length <= 25,
                'Max 25 artists per server',
            ],
        },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        updatedAt: { type: Date },
    },
    { _id: false },
);

const guildNotificationConfigSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true, index: true },
        epic: { type: epicConfigSchema, default: () => ({}) },
        gameUpdates: { type: gameUpdatesConfigSchema, default: () => ({}) },
        artistReleases: { type: artistReleasesConfigSchema, default: () => ({}) },
    },
    { timestamps: true },
);

module.exports = mongoose.model('GuildNotificationConfig', guildNotificationConfigSchema);
