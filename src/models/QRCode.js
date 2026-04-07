const mongoose = require('mongoose');

const QRCodeSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'scanned', 'authenticated', 'expired'],
        default: 'pending'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    deviceInfo: {
        userAgent: String,
        ip: String
    },
    issuedSessionId: {
        type: String,
        default: null
    },
    issuedTokens: {
        accessToken: String,
        refreshToken: String,
        expiresIn: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300
    },
    scannedAt: {
        type: Date,
        default: null
    },
    authenticatedAt: {
        type: Date,
        default: null
    }
});

module.exports = mongoose.model('QRCode', QRCodeSchema);
