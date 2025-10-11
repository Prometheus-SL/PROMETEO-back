const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/database');
const Agent = require('./models/Agent');
const AgentData = require('./models/AgentData');

const PORT = process.env.PORT || 3000;

// Conectar a la base de datos
connectDB();

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.io
// Configurar CORS para Socket.io coherente con Express
const parseOrigins = (value) => {
    if (!value) return ['http://localhost:3001'];
    return value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
};
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || process.env.CLIENT_URL);
const allowCredentials = String(process.env.CORS_CREDENTIALS).toLowerCase() === 'true';

const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

// Estado global para manejar información de agentes
const agentState = {
    connectedAgents: new Map(),
    latestData: null
};

// Configurar eventos de Socket.io
io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Evento para identificar el tipo de cliente (agente o frontend)
    socket.on('identify', async (data) => {
        const { type, agentId } = data;

        if (type === 'agent') {
            // Registrar agente
            const finalAgentId = agentId || socket.id;
            socket.agentId = finalAgentId;

            agentState.connectedAgents.set(socket.id, {
                agentId: finalAgentId,
                connectedAt: new Date(),
                socketId: socket.id
            });

            socket.join('agents');
            console.log(`Agente registrado: ${finalAgentId}`);

            // Actualizar estado en base de datos
            try {
                await Agent.findOneAndUpdate(
                    { agentId: finalAgentId },
                    {
                        $set: {
                            isOnline: true,
                            lastSeen: new Date(),
                            'connectionInfo.socketId': socket.id,
                            'connectionInfo.ipAddress': socket.handshake.address,
                            'connectionInfo.userAgent': socket.handshake.headers['user-agent'],
                            'connectionInfo.connectedAt': new Date()
                        }
                    },
                    { upsert: false }
                );
            } catch (error) {
                console.error('Error actualizando agente en BD:', error);
            }

            // Notificar al frontend sobre el nuevo agente
            socket.to('frontend').emit('agent-connected', {
                agentId: finalAgentId,
                connectedAt: new Date()
            });
        } else if (type === 'frontend') {
            socket.join('frontend');
            console.log('Cliente frontend conectado');

            // Enviar estado actual de agentes conectados
            const agents = Array.from(agentState.connectedAgents.values());
            socket.emit('agents-status', agents);

            // Enviar último dato si existe
            if (agentState.latestData) {
                socket.emit('agent-data', agentState.latestData);
            }
        }
    });

    // Evento para recibir datos del agente
    socket.on('agent-data', async (data) => {
        try {
            console.log('Datos recibidos del agente:', data);

            const agentInfo = agentState.connectedAgents.get(socket.id);
            const agentId = agentInfo?.agentId || socket.id;

            // Guardar datos en MongoDB
            const agentData = new AgentData({
                agentId: agentId,
                data: data,
                dataType: data.type || 'sensor',
                priority: data.priority || 'normal',
                tags: data.tags || [],
                metadata: {
                    socketId: socket.id,
                    ipAddress: socket.handshake.address,
                    userAgent: socket.handshake.headers['user-agent']
                }
            });

            await agentData.save();

            // Actualizar agente en base de datos
            await Agent.findOneAndUpdate(
                { agentId: agentId },
                {
                    lastSeen: new Date(),
                    lastData: new Date(),
                    'connectionInfo.socketId': socket.id
                },
                { upsert: false }
            );

            // Guardar último dato en memoria para compatibilidad
            agentState.latestData = {
                ...data,
                timestamp: agentData.createdAt,
                agentId: agentId,
                id: agentData._id
            };

            // Reenviar datos al frontend
            io.to('frontend').emit('agent-data', agentState.latestData);

        } catch (error) {
            console.error('Error procesando datos del agente:', error);
            socket.emit('error', { message: 'Error procesando datos' });
        }
    });    // Evento para solicitar datos específicos al agente
    socket.on('request-agent-data', (request) => {
        // Reenviar solicitud a todos los agentes conectados
        socket.to('agents').emit('data-request', request);
    });

    // Evento para confirmar recepción de comando
    socket.on('command-received', async (data) => {
        try {
            const { commandId } = data;
            const Command = require('./models/Command');

            const command = await Command.findOne({ commandId });
            if (command) {
                await command.markAsReceived();
                console.log(`Comando ${commandId} recibido por agente ${socket.agentId}`);
            }
        } catch (error) {
            console.error('Error marcando comando como recibido:', error);
        }
    });

    // Evento para respuesta de comando ejecutado
    socket.on('command-response', async (data) => {
        try {
            const { commandId, success, result, error, executionTime } = data;
            const Command = require('./models/Command');

            const command = await Command.findOne({ commandId });
            if (command) {
                await command.markAsCompleted({
                    success,
                    data: result,
                    error,
                    executionTime
                });

                console.log(`Comando ${commandId} ${success ? 'completado' : 'falló'} en agente ${socket.agentId}`);

                // Notificar al frontend sobre el resultado
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

    // Evento de desconexión
    socket.on('disconnect', () => {
        console.log(`Cliente desconectado: ${socket.id}`);

        // Si era un agente, removerlo del estado
        if (agentState.connectedAgents.has(socket.id)) {
            const agent = agentState.connectedAgents.get(socket.id);
            agentState.connectedAgents.delete(socket.id);

            // Notificar al frontend sobre la desconexión
            io.to('frontend').emit('agent-disconnected', {
                agentId: agent.agentId,
                disconnectedAt: new Date()
            });

            console.log(`Agente desconectado: ${agent.agentId}`);
        }
    });

    // Evento para ping/pong personalizado
    socket.on('ping', () => {
        socket.emit('pong');
    });
});

// Hacer io accesible globalmente para uso en rutas si es necesario
app.set('io', io);

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor PROMETEO funcionando en puerto ${PORT}`);
    console.log(`📡 WebSocket listo para conexiones`);
    console.log(`🌐 CORS habilitado para: ${allowedOrigins.join(', ')} | credenciales: ${allowCredentials}`);
});

// Manejo de errores del servidor
server.on('error', (error) => {
    console.error('Error del servidor:', error);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('Cerrando servidor...');
    server.close(() => {
        console.log('Servidor cerrado correctamente');
        process.exit(0);
    });
});

module.exports = { server, io };