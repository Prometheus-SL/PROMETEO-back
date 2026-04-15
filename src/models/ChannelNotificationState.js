const mongoose = require('mongoose');

const channelNotificationStateSchema = new mongoose.Schema(
    {
        channelId: { type: String, required: true },
        source: { type: String, required: true },
        lastNotifiedIds: { type: [String], default: [] },
        lastNotifiedAt: { type: Date, default: null },
    },
    { timestamps: true },
);

channelNotificationStateSchema.index({ channelId: 1, source: 1 }, { unique: true });

module.exports = mongoose.model('ChannelNotificationState', channelNotificationStateSchema);
