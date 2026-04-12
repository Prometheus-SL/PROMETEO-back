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
    latestDataByAgent: new Map()
};
const MANUAL_AGENT_MODES = new Set(['manual', 'interactive']);

function isPrivilegedUser(user) {
    return ['admin', 'operator'].includes(user?.role);
}

function buildFrontendUserRoom(userId) {
    return `frontend:user:${String(userId)}`;
}

function buildConnectionInfo(socket, overrides = {}) {
    return {
        socketId: socket.id,
        ipAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'] || null,
        ...overrides
    };
}

function bytesToGigabytes(bytes) {
    const numericBytes = Number(bytes) || 0;
    return Number((numericBytes / (1024 * 1024 * 1024)).toFixed(2));
}

function buildComputerInfoFromSnapshot(snapshot = {}) {
    const disks = Array.isArray(snapshot?.resources?.disks) ? snapshot.resources.disks : [];
    const interfaces = Array.isArray(snapshot?.network?.interfaces) ? snapshot.network.interfaces : [];

    return {
        hostname: snapshot?.system?.hostname || null,
        username: snapshot?.system?.username || null,
        os: {
            platform: snapshot?.system?.os?.platform || null,
            release: snapshot?.system?.os?.release || null,
            arch: snapshot?.system?.os?.arch || null
        },
        hardware: {
            cpu: {
                model: snapshot?.resources?.cpu?.model || null,
                cores: snapshot?.resources?.cpu?.cores || null,
                speed: snapshot?.resources?.cpu?.speedMHz || null
            },
            memory: {
                total: bytesToGigabytes(snapshot?.resources?.memory?.totalBytes),
                available: bytesToGigabytes(snapshot?.resources?.memory?.freeBytes)
            },
            storage: disks.map((disk) => ({
                drive: disk.drive,
                total: bytesToGigabytes(disk.totalBytes),
                free: bytesToGigabytes(disk.freeBytes)
            }))
        },
        network: {
            ip: snapshot?.network?.ip || null,
            mac: snapshot?.network?.mac || null,
            interfaces: interfaces.map((item) => `${item.name}:${item.address}`)
        }
    };
}

function buildEffectiveSnapshot(socket, data = {}) {
    if (data?.dataType !== 'system_status') {
        return data;
    }

    const previous = agentState.latestDataByAgent.get(socket.agentId);
    const incomingAudioAvailable = data?.audio?.available === true;
    const previousAudioAvailable = previous?.audio?.available === true;
    const isServiceSnapshot = !MANUAL_AGENT_MODES.has(String(data?.mode || socket.data?.agentMode || '').toLowerCase());

    if (incomingAudioAvailable || !previousAudioAvailable || !isServiceSnapshot) {
        return data;
    }

    return {
        ...data,
        audio: previous.audio,
    };
}

function registerConnectedAgent(socket, agentId, userId, mode = null) {
    socket.agentId = agentId;
    socket.userId = String(userId);
    socket.data.clientType = 'agent';
    socket.data.isAuthenticatedAgent = true;
    socket.data.agentOwnerId = String(userId);
    socket.data.agentMode = mode || socket.data.agentMode || 'service';
    socket.data.mediaAvailable = false;

    const payload = {
        agentId,
        userId: String(userId),
        connectedAt: new Date(),
        socketId: socket.id,
        mode: socket.data.agentMode
    };

    socket.data.connectedAt = payload.connectedAt.getTime();
    agentState.connectedAgents.set(socket.id, payload);
    socket.join('agents');
    return payload;
}

function getConnectedAgentsForUser(user) {
    const values = Array.from(agentState.connectedAgents.values());
    if (isPrivilegedUser(user)) {
        return values;
    }

    return values.filter((agent) => String(agent.userId) === String(user._id));
}

function emitToAuthorizedFrontends(event, payload, ownerUserId) {
    const target = ownerUserId
        ? io.to('frontend:admins').to(buildFrontendUserRoom(ownerUserId))
        : io.to('frontend:admins');

    target.emit(event, payload);
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
        const error = new Error('El agente estÃ¡ desactivado');
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
    return Agent.findOneAndUpdate({ agentId }, update, { upsert: false, new: true });
}

io.on('connection', (socket) => {
    socket.data.clientType = 'unknown';
    socket.data.isAuthenticatedAgent = false;

    console.log(`Cliente conectado: ${socket.id}`);

    socket.on('identify', async (data = {}) => {
        const { type, agentId, token, mode } = data || {};

        if (type === 'agent') {
            const finalAgentId = agentId || socket.id;

            try {
                if (!token) {
                    throw new Error('Token requerido para agentes');
                }

                const auth = await verifyAccessToken(token);
                const agentDoc = await attachAgentOwnership(auth.user._id, finalAgentId);

                registerConnectedAgent(socket, finalAgentId, auth.user._id, mode);
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

                emitToAuthorizedFrontends('agent-connected', {
                    agentId: finalAgentId,
                    connectedAt: new Date(),
                    userId: String(agentDoc.user)
                }, agentDoc.user);
            } catch (error) {
                console.error('Error validando agente/token:', error);
                socket.emit('error', { message: error.message || 'Error de autenticaciÃ³n de agente' });
                socket.disconnect(true);
            }

            return;
        }

        if (type === 'frontend') {
            try {
                if (!token) {
                    throw new Error('Token requerido para frontend');
                }

                const auth = await verifyAccessToken(token);
                socket.data.clientType = 'frontend';
                socket.data.isAuthenticatedFrontend = true;
                socket.userId = String(auth.user._id);
                socket.userRole = auth.user.role;
                socket.join('frontend');
                socket.join(buildFrontendUserRoom(auth.user._id));

                if (isPrivilegedUser(auth.user)) {
                    socket.join('frontend:admins');
                }

                console.log(`Cliente frontend autenticado: ${socket.userId}`);
                socket.emit('agents-status', getConnectedAgentsForUser(auth.user));
            } catch (error) {
                console.error('Error autenticando frontend en socket:', error);
                socket.emit('error', { message: error.message || 'Error de autenticaciÃ³n de frontend' });
                socket.disconnect(true);
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
            socket.data.agentMode = data.mode || socket.data.agentMode || 'service';
            socket.data.audioAvailable = data?.audio?.available === true;
            if (data?.dataType === 'media_update') {
                socket.data.mediaAvailable = data?.media?.available === true;
            }

            const effectiveData = buildEffectiveSnapshot(socket, data);
            const dataType = effectiveData.dataType || 'sensor';
            const agentData = new AgentData({
                agentId: socket.agentId,
                data: effectiveData,
                dataType,
                priority: effectiveData.priority || 'normal',
                tags: Array.isArray(effectiveData.tags) ? effectiveData.tags : [],
                metadata: buildConnectionInfo(socket)
            });

            await agentData.save();

            const updatePayload = {
                lastSeen: new Date(),
                lastData: new Date(),
                status: 'online',
                connectionInfo: buildConnectionInfo(socket, {
                    connectedAt: agentState.connectedAgents.get(socket.id)?.connectedAt || new Date(),
                    disconnectedAt: null
                })
            };

            if (dataType === 'system_status') {
                updatePayload.computerInfo = buildComputerInfoFromSnapshot(effectiveData);
            }

            await updateAgentPresence(socket.agentId, {
                $set: updatePayload
            });

            const payload = {
                ...effectiveData,
                timestamp: agentData.createdAt,
                agentId: socket.agentId,
                id: agentData._id
            };

            agentState.latestDataByAgent.set(socket.agentId, payload);
            emitToAuthorizedFrontends('agent-data', payload, socket.data.agentOwnerId);
        } catch (error) {
            console.error('Error procesando datos del agente:', error);
            socket.emit('error', { message: 'Error procesando datos' });
        }
    });

    socket.on('request-agent-data', (request) => {
        if (socket.data?.clientType !== 'frontend' || !socket.data?.isAuthenticatedFrontend) {
            socket.emit('error', { message: 'Solo el frontend autenticado puede solicitar datos' });
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

                console.log(`Comando ${commandId} ${success ? 'completado' : 'fallÃ³'} en agente ${socket.agentId}`);

                emitToAuthorizedFrontends('command-result', {
                    commandId,
                    agentId: socket.agentId,
                    success,
                    result,
                    error,
                    executionTime,
                    timestamp: new Date().toISOString()
                }, socket.data.agentOwnerId);
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

        emitToAuthorizedFrontends('agent-disconnected', {
            agentId: agent.agentId,
            disconnectedAt: new Date()
        }, agent.userId);

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
