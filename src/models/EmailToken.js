const mongoose = require('mongoose');

const emailTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    tokenHash: {
        type: String,
        required: true,
        unique: true,
    },
    type: {
        type: String,
        enum: ['email-verification', 'password-reset'],
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expireAfterSeconds: 0 },
    },
});

module.exports = mongoose.model('EmailToken', emailTokenSchema);
