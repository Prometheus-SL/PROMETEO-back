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
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300 // El código QR expira en 5 minutos
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

// Los índices se definen en el schema directamente para evitar duplicados

module.exports = mongoose.model('QRCode', QRCodeSchema);