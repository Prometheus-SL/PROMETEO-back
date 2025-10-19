const mongoose = require('mongoose');

const WhatsAppSessionSchema = new mongoose.Schema(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        archiveSize: {
            type: Number,
            default: 0,
        },
        chunkCount: {
            type: Number,
            default: 0,
        },
        lastSyncedAt: {
            type: Date,
        },
        state: {
            type: mongoose.Schema.Types.Mixed,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        minimize: false,
    }
);

module.exports = mongoose.model('WhatsAppSession', WhatsAppSessionSchema);
