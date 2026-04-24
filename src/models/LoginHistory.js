const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    username: {
        type: String,
        default: null,
    },
    method: {
        type: String,
        enum: ['password', 'qr', 'agent', 'refresh', 'oauth'],
        default: 'password',
    },
    provider: {
        type: String,
        default: null,
    },
    identifier: {
        type: String,
        default: null,
    },
    success: {
        type: Boolean,
        required: true,
    },
    ip: {
        type: String,
        default: null,
    },
    userAgent: {
        type: String,
        default: null,
    },
    sessionId: {
        type: String,
        default: null,
    },
    failureReason: {
        type: String,
        default: null,
    },
}, {
    timestamps: true,
});

loginHistorySchema.index({ userId: 1, createdAt: -1 });
loginHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
