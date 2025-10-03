const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema({
    commandId: {
        type: String,
        required: true,
        unique: true
    },
    agentId: {
        type: String,
        required: [true, 'Agent ID es requerido'],
        ref: 'Agent'
    },
    sentBy: {
        type: String,
        required: [true, 'Usuario que envía el comando es requerido']
    },
    command: {
        type: String,
        required: [true, 'Comando es requerido'],
        enum: [
            // Control de volumen
            'volume_set',
            'volume_mute',
            'volume_unmute',
            'volume_up',
            'volume_down',

            // Control de sesión
            'lock_screen',
            'logout_user',

            // Control de energía
            'shutdown',
            'restart',
            'hibernate',
            'sleep',

            // Monitoreo
            'get_system_info',
            'get_performance',
            'take_screenshot',
            'get_network_info',

            // Configuración
            'update_agent',
            'change_settings',
            'restart_agent',

            // Comunicación
            'send_message',
            'show_notification'
        ]
    },
    parameters: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'received', 'executing', 'completed', 'failed', 'timeout'],
        default: 'pending'
    },
    sentAt: Date,
    receivedAt: Date,
    executedAt: Date,
    completedAt: Date,
    response: {
        success: Boolean,
        data: mongoose.Schema.Types.Mixed,
        error: String,
        executionTime: Number // milisegundos
    },
    timeout: {
        type: Number,
        default: 30000 // 30 segundos
    },
    retries: {
        current: {
            type: Number,
            default: 0
        },
        max: {
            type: Number,
            default: 3
        }
    }
}, {
    timestamps: true
});

// Índices para optimizar búsquedas
commandSchema.index({ agentId: 1, createdAt: -1 });
commandSchema.index({ status: 1 });
commandSchema.index({ priority: 1 });
commandSchema.index({ sentBy: 1 });
commandSchema.index({ scheduledFor: 1 });

// TTL para auto-eliminación de comandos antiguos (90 días)
commandSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Método para marcar comando como enviado
commandSchema.methods.markAsSent = function () {
    this.status = 'sent';
    this.sentAt = new Date();
    return this.save();
};

// Método para marcar comando como recibido
commandSchema.methods.markAsReceived = function () {
    this.status = 'received';
    this.receivedAt = new Date();
    return this.save();
};

// Método para marcar comando como completado
commandSchema.methods.markAsCompleted = function (response) {
    this.status = response.success ? 'completed' : 'failed';
    this.completedAt = new Date();
    this.response = response;
    return this.save();
};

// Método estático para obtener comandos pendientes de un agente
commandSchema.statics.getPendingCommands = function (agentId) {
    return this.find({
        agentId,
        status: { $in: ['pending', 'sent'] },
        scheduledFor: { $lte: new Date() }
    }).sort({ priority: -1, scheduledFor: 1 });
};

module.exports = mongoose.model('Command', commandSchema);