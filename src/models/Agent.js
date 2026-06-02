const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
    // Usuario propietario del agente
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
        required: false
    },
    agentId: {
        type: String,
        required: [true, 'Agent ID es requerido'],
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: [true, 'Nombre del agente es requerido'],
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    apiKey: {
        type: String,
        required: [true, 'API Key es requerida'],
        unique: true,
        // No se devuelve por defecto: hay que pedirla con .select('+apiKey').
        // Evita filtrarla en las muchas consultas que devuelven el doc del agente.
        select: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    status: {
        type: String,
        enum: ['online', 'offline', 'maintenance', 'error', 'locked'],
        default: 'offline'
    },
    // Información del equipo
    computerInfo: {
        hostname: String,
        username: String,
        os: {
            platform: String, // 'win32', 'darwin', 'linux'
            release: String,   // Version del SO
            arch: String       // 'x64', 'arm64', etc.
        },
        hardware: {
            cpu: {
                model: String,
                cores: Number,
                speed: Number // GHz
            },
            memory: {
                total: Number, // GB
                available: Number
            },
            storage: [{
                drive: String,
                total: Number, // GB
                free: Number
            }]
        },
        network: {
            ip: String,
            mac: String,
            interfaces: [String]
        }
    },
    // Configuración del agente
    config: {
        monitoringInterval: {
            type: Number,
            default: 30000 // 30 segundos
        },
        allowedCommands: [String],
        autoUpdate: {
            type: Boolean,
            default: true
        },
        securityLevel: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        }
    },
    // Ubicación opcional (usada por rutas/api)
    location: {
        type: String,
        trim: true
    },
    lastSeen: {
        type: Date
    },
    lastData: {
        type: Date
    },
    connectionInfo: {
        socketId: String,
        ipAddress: String,
        userAgent: String,
        connectedAt: Date,
        disconnectedAt: Date
    }
}, {
    timestamps: true
});

// Índices para optimizar búsquedas (agentId ya tiene índice por unique: true)
agentSchema.index({ status: 1 });
agentSchema.index({ lastSeen: -1 });
agentSchema.index({ user: 1, agentId: 1 });

// Método para actualizar estado de conexión
agentSchema.methods.updateConnectionStatus = function (status, connectionInfo = {}) {
    this.status = status;
    this.lastSeen = new Date();

    if (status === 'online') {
        this.connectionInfo = {
            ...(this.connectionInfo || {}),
            ...connectionInfo,
            connectedAt: new Date()
        };
    } else {
        this.connectionInfo = {
            ...(this.connectionInfo || {}),
            disconnectedAt: new Date(),
            socketId: null
        };
    }

    return this.save();
};

module.exports = mongoose.model('Agent', agentSchema);
