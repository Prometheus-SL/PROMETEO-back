const http = require('http');
const { randomBytes } = require('crypto');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/database');
const Agent = require('./models/Agent');
const AgentData = require('./models/AgentData');
const Command = require('./models/Command');
const { verifyAccessToken } = require('./middleware/auth');

const PORT = process.env.PORT || 3000;

connectDB();

const server = http.createServer(app);

const parseOrigins = (value) => {
    if (!value) return ['http://localhost:3001'];
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || process.env.CLIENT_URL);
const allowCredentials = String(process.env.CORS_CREDENTIALS).toLowerCase() === 'true';

function isOriginAllowed(origin) {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;

    return allowedOrigins.some((value) => {
        if (!value.startsWith('/') || !value.endsWith('/')) {
            return false;
        }

        try {
            return new RegExp(value.slice(1, -1)).test(origin);
        } catch (_error) {
            return false;
        }
    });
}

const io = new Server(server, {
    pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT || 60000),
    pingInterval: Number(process.env.SOCKET_PING_INTERVAL || 25000),
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Origen no permitido por CORS'));
        },
        credentials: allowCredentials,
        methods: ['GET', 'POST']
    }
});

const agentState = {
    connectedAgents: new Map(),
    latestData: null
};

function buildConnectionInfo(socket, overrides = {}) {
    return {
        socketId: socket.id,
        ipAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'] || null,
        ...overrides
    };
}

function registerConnectedAgent(socket, agentId) {
    socket.agentId = agentId;
    socket.data.clientType = 'agent';
    socket.data.isAuthenticatedAgent = true;

    const payload = {
        agentId,
        connectedAt: new Date(),
        socketId: socket.id
    };

    agentState.connectedAgents.set(socket.id, payload);
    socket.join('agents');
    return payload;
}

async function attachAgentOwnership(userId, agentId) {
    let agentDoc = await Agent.findOne({ agentId });
    if (!agentDoc) {
        agentDoc = new Agent({
            agentId,
            name: agentId,
            description: 'Agente creado desde socket',
            apiKey: randomBytes(32).toString('hex'),
            user: userId,
            status: 'offline'
        });
        await agentDoc.save();
        return agentDoc;
    }

    if (!agentDoc.isActive) {
        const error = new Error('El agente está desactivado');
        error.status = 403;
        throw error;
    }

    if (!agentDoc.user) {
        agentDoc.user = userId;
        await agentDoc.save();
        return agentDoc;
    }

    if (String(agentDoc.user) !== String(userId)) {
        const error = new Error('Este agente pertenece a otro usuario');
        error.status = 403;
        throw error;
    }

    return agentDoc;
}

async function updateAgentPresence(agentId, update) {
    await Agent.findOneAndUpdate({ agentId }, update, { upsert: false });
}

io.on('connection', (socket) => {
    socket.data.clientType = 'unknown';
    socket.data.isAuthenticatedAgent = false;

    console.log(`Cliente conectado: ${socket.id}`);

    socket.on('identify', async (data = {}) => {
        const { type, agentId, token } = data || {};

        if (type === 'agent') {
            const finalAgentId = agentId || socket.id;

            try {
                if (!token) {
                    throw new Error('Token requerido para agentes');
                }

                const auth = await verifyAccessToken(token);
                const agentDoc = await attachAgentOwnership(auth.user._id, finalAgentId);

                registerConnectedAgent(socket, finalAgentId);
                socket.userId = auth.user._id.toString();
                socket.data.sessionId = auth.sessionId || null;

                await updateAgentPresence(finalAgentId, {
                    $set: {
                        status: 'online',
                        lastSeen: new Date(),
                        connectionInfo: buildConnectionInfo(socket, {
                            connectedAt: new Date(),
                            disconnectedAt: null
                        })
                    }
                });

                socket.to('frontend').emit('agent-connected', {
                    agentId: finalAgentId,
                    connectedAt: new Date(),
                    userId: agentDoc.user
                });
            } catch (error) {
                console.error('Error validando agente/token:', error);
                socket.emit('error', { message: error.message || 'Error de autenticación de agente' });
                socket.disconnect(true);
            }

            return;
        }

        if (type === 'frontend') {
            socket.data.clientType = 'frontend';
            socket.join('frontend');
            console.log('Cliente frontend conectado');

            socket.emit('agents-status', Array.from(agentState.connectedAgents.values()));

            if (agentState.latestData) {
                socket.emit('agent-data', agentState.latestData);
            }

            return;
        }

        socket.emit('error', { message: 'Tipo de cliente no soportado' });
    });

    socket.on('agent-data', async (data = {}) => {
        if (socket.data?.clientType !== 'agent' || !socket.data?.isAuthenticatedAgent || !socket.agentId) {
            socket.emit('error', { message: 'Agente no autenticado' });
            return;
        }

        try {
            const agentData = new AgentData({
                agentId: socket.agentId,
                data,
                dataType: data.dataType || 'sensor',
                priority: data.priority || 'normal',
                tags: Array.isArray(data.tags) ? data.tags : [],
                metadata: buildConnectionInfo(socket)
            });

            await agentData.save();

            await updateAgentPresence(socket.agentId, {
                $set: {
                    lastSeen: new Date(),
                    lastData: new Date(),
                    connectionInfo: buildConnectionInfo(socket, {
                        connectedAt: agentState.connectedAgents.get(socket.id)?.connectedAt || new Date(),
                        disconnectedAt: null
                    })
                }
            });

            agentState.latestData = {
                ...data,
                timestamp: agentData.createdAt,
                agentId: socket.agentId,
                id: agentData._id
            };

            io.to('frontend').emit('agent-data', agentState.latestData);
        } catch (error) {
            console.error('Error procesando datos del agente:', error);
            socket.emit('error', { message: 'Error procesando datos' });
        }
    });

    socket.on('request-agent-data', (request) => {
        if (socket.data?.clientType !== 'frontend') {
            socket.emit('error', { message: 'Solo el frontend puede solicitar datos' });
            return;
        }

        socket.to('agents').emit('data-request', request);
    });

    socket.on('command-received', async (data = {}) => {
        if (!socket.data?.isAuthenticatedAgent || !socket.agentId) {
            return;
        }

        try {
            const { commandId } = data;
            if (!commandId) return;

            const command = await Command.findOne({ commandId, agentId: socket.agentId });
            if (command) {
                await command.markAsReceived();
                console.log(`Comando ${commandId} recibido por agente ${socket.agentId}`);
            }
        } catch (error) {
            console.error('Error marcando comando como recibido:', error);
        }
    });

    socket.on('command-response', async (data = {}) => {
        if (!socket.data?.isAuthenticatedAgent || !socket.agentId) {
            return;
        }

        try {
            const { commandId, success, result, error, executionTime } = data;
            if (!commandId) return;

            const command = await Command.findOne({ commandId, agentId: socket.agentId });
            if (command) {
                await command.markAsCompleted({
                    success,
                    data: result,
                    error,
                    executionTime
                });

                console.log(`Comando ${commandId} ${success ? 'completado' : 'falló'} en agente ${socket.agentId}`);

                io.to('frontend').emit('command-result', {
                    commandId,
                    agentId: socket.agentId,
                    success,
                    result,
                    error,
                    executionTime,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Error procesando respuesta de comando:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Cliente desconectado: ${socket.id}`);

        if (!agentState.connectedAgents.has(socket.id)) {
            return;
        }

        const agent = agentState.connectedAgents.get(socket.id);
        agentState.connectedAgents.delete(socket.id);

        io.to('frontend').emit('agent-disconnected', {
            agentId: agent.agentId,
            disconnectedAt: new Date()
        });

        updateAgentPresence(agent.agentId, {
            $set: {
                status: 'offline',
                lastSeen: new Date(),
                connectionInfo: buildConnectionInfo(socket, {
                    connectedAt: agent.connectedAt,
                    disconnectedAt: new Date(),
                    socketId: null
                })
            }
        }).catch((error) => console.error('Error actualizando estado de agente en BD:', error));

        console.log(`Agente desconectado: ${agent.agentId}`);
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });
});

app.set('io', io);

server.listen(PORT, () => {
    console.log(`Servidor PROMETEO funcionando en puerto ${PORT}`);
    console.log('WebSocket listo para conexiones');
    console.log(`CORS habilitado para: ${allowedOrigins.join(', ')} | credenciales: ${allowCredentials}`);
});

server.on('error', (error) => {
    console.error('Error del servidor:', error);
});

process.on('SIGTERM', () => {
    console.log('Cerrando servidor...');
    server.close(() => {
        console.log('Servidor cerrado correctamente');
        process.exit(0);
    });
});

module.exports = { server, io };
