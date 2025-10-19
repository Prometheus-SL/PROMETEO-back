const mongoose = require('mongoose');

const WhatsAppSessionChunkSchema = new mongoose.Schema(
    {
        sessionId: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        index: {
            type: Number,
            required: true,
        },
        data: {
            type: Buffer,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

WhatsAppSessionChunkSchema.index({ sessionId: 1, index: 1 }, { unique: true });

module.exports = mongoose.model('WhatsAppSessionChunk', WhatsAppSessionChunkSchema);
