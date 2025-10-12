const mongoose = require('mongoose');

const agentDataSchema = new mongoose.Schema({
    agentId: {
        type: String,
        required: [true, 'Agent ID es requerido'],
        ref: 'Agent'
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: [true, 'Data es requerida']
    },
    dataType: {
        type: String,
        enum: [
            'sensor',            // Datos genéricos del agente
            'system_status',      // Estado general del sistema
            'performance',        // CPU, RAM, disco
            'network',           // Tráfico de red, conexiones
            'processes',         // Procesos en ejecución
            'user_activity',     // Actividad del usuario
            'hardware',          // Estado del hardware
            'software',          // Software instalado
            'alert',             // Alertas del sistema
            'command_response',  // Respuesta a comandos
            'media_update',        // Actualizaciones de medios
            'log'                // Logs del sistema
        ],
        default: 'system_status'
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal'
    },
    tags: [{
        type: String,
        trim: true
    }],
    processed: {
        type: Boolean,
        default: false
    },
    processedAt: {
        type: Date
    },
    metadata: {
        socketId: String,
        ipAddress: String,
        userAgent: String,
        location: {
            latitude: Number,
            longitude: Number
        }
    }
}, {
    timestamps: true
});

// Índices para optimizar búsquedas
agentDataSchema.index({ agentId: 1, createdAt: -1 });
agentDataSchema.index({ dataType: 1 });
agentDataSchema.index({ priority: 1 });
agentDataSchema.index({ processed: 1 });
agentDataSchema.index({ tags: 1 });

// TTL para auto-eliminación de datos antiguos (30 días)
// Usamos un índice separado para TTL sin conflicto con otros índices de createdAt
agentDataSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Método estático para obtener últimos datos de un agente
agentDataSchema.statics.getLatestByAgent = function (agentId, limit = 10) {
    return this.find({ agentId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec();
};

// Método estático para obtener datos por rango de fechas
agentDataSchema.statics.getByDateRange = function (agentId, startDate, endDate) {
    const query = { agentId };

    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    return this.find(query).sort({ createdAt: -1 }).exec();
};

module.exports = mongoose.model('AgentData', agentDataSchema);