const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    username: {
        type: String,
        required: true,
    },
    method: {
        type: String,
        enum: ['password', 'qr', 'agent', 'refresh'],
        default: 'password',
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
loginHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
