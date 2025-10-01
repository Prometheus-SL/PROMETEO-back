const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.io
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3001',
        methods: ['GET', 'POST'],
        credentials: true
    },
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
    socket.on('identify', (data) => {
        const { type, agentId } = data;

        if (type === 'agent') {
            // Registrar agente
            agentState.connectedAgents.set(socket.id, {
                agentId: agentId || socket.id,
                connectedAt: new Date(),
                socketId: socket.id
            });

            socket.join('agents');
            console.log(`Agente registrado: ${agentId || socket.id}`);

            // Notificar al frontend sobre el nuevo agente
            socket.to('frontend').emit('agent-connected', {
                agentId: agentId || socket.id,
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
    socket.on('agent-data', (data) => {
        console.log('Datos recibidos del agente:', data);

        // Guardar último dato
        agentState.latestData = {
            ...data,
            timestamp: new Date(),
            agentId: agentState.connectedAgents.get(socket.id)?.agentId || socket.id
        };

        // Reenviar datos al frontend
        io.to('frontend').emit('agent-data', agentState.latestData);
    });

    // Evento para solicitar datos específicos al agente
    socket.on('request-agent-data', (request) => {
        // Reenviar solicitud a todos los agentes conectados
        socket.to('agents').emit('data-request', request);
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
    console.log(`🌐 CORS habilitado para: ${process.env.CLIENT_URL || 'http://localhost:3001'}`);
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