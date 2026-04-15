const ChannelNotificationState = require('../../models/ChannelNotificationState');

function createChannelStateStore({ Model = ChannelNotificationState } = {}) {
    return {
        async getKnownIds(channelId, source) {
            const doc = await Model.findOne({ channelId, source }).lean();
            return new Set(doc?.lastNotifiedIds ?? []);
        },
        async recordSent(channelId, source, ids) {
            await Model.findOneAndUpdate(
                { channelId, source },
                { lastNotifiedIds: ids, lastNotifiedAt: new Date() },
                { upsert: true, new: true, setDefaultsOnInsert: true },
            );
        },
    };
}

function createNoopChannelStateStore() {
    return {
        async getKnownIds() {
            return new Set();
        },
        async recordSent() {
            /* no-op */
        },
    };
}

module.exports = { createChannelStateStore, createNoopChannelStateStore };
