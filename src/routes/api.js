const express = require('express');
const router = express.Router();

// Ruta para obtener información de agentes conectados
router.get('/agents', (req, res) => {
    const io = req.app.get('io');

    // Obtener información de los sockets conectados
    const connectedSockets = [];
    io.of('/').sockets.forEach((socket) => {
        connectedSockets.push({
            id: socket.id,
            connected: socket.connected,
            rooms: Array.from(socket.rooms)
        });
    });

    res.json({
        success: true,
        data: {
            totalConnections: connectedSockets.length,
            connections: connectedSockets
        }
    });
});

// Ruta para obtener estadísticas del servidor
router.get('/stats', (req, res) => {
    const io = req.app.get('io');

    res.json({
        success: true,
        data: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
            totalConnections: io.of('/').sockets.size,
            version: '1.0.0'
        }
    });
});

// Ruta para enviar comando a agentes (POST)
router.post('/agents/command', (req, res) => {
    const io = req.app.get('io');
    const { command, data } = req.body;

    if (!command) {
        return res.status(400).json({
            success: false,
            error: 'Comando requerido'
        });
    }

    // Enviar comando a todos los agentes conectados
    io.to('agents').emit('command', {
        command,
        data,
        timestamp: new Date().toISOString()
    });

    res.json({
        success: true,
        message: `Comando '${command}' enviado a todos los agentes`,
        timestamp: new Date().toISOString()
    });
});

// Ruta para obtener el último dato recibido
router.get('/data/latest', (req, res) => {
    // Aquí podrías implementar una base de datos o cache para almacenar datos
    // Por ahora, devolvemos un ejemplo
    res.json({
        success: true,
        data: {
            message: 'Último dato disponible',
            timestamp: new Date().toISOString(),
            // Aquí irían los datos reales del agente
        }
    });
});

module.exports = router;