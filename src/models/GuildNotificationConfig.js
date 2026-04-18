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

const guildNotificationConfigSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true, unique: true, index: true },
        epic: { type: epicConfigSchema, default: () => ({}) },
    },
    { timestamps: true },
);

module.exports = mongoose.model('GuildNotificationConfig', guildNotificationConfigSchema);
