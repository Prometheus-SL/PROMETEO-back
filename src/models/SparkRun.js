const mongoose = require('mongoose');

const SparkRunSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['waiting_for_client', 'completed', 'failed', 'expired'],
        default: 'waiting_for_client',
        index: true,
    },
    messages: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    tools: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    pendingClientActions: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    toolResults: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true,
    },
}, { timestamps: true });

SparkRunSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SparkRun', SparkRunSchema);
