const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const Agent = require('../models/Agent');
const Command = require('../models/Command');
let uuidv4;

import('uuid').then(module => {
    uuidv4 = module.v4; // Cambia esto
});

const router = express.Router();

// Instalar uuid si no está instalado
// npm install uuid

// POST /control/command - Enviar comando a un agente específico
router.post('/command', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const { agentId, command, args = {}, priority = 'normal', scheduledFor } = req.body;

        if (!agentId || !command) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID y comando son requeridos'
            });
        }

        // Verificar que el agente existe
        const agent = await Agent.findOne({ agentId });
        if (!agent) {
            return res.status(404).json({
                success: false,
                error: 'Agente no encontrado'
            });
        }

        // Verificar que el agente esté online para comandos inmediatos
        if (!scheduledFor && agent.status !== 'online') {
            return res.status(400).json({
                success: false,
                error: 'El agente debe estar online para enviar comandos inmediatos'
            });
        }

        // Crear comando
        const newCommand = new Command({
            commandId: uuidv4(),
            agentId,
            sentBy: req.user.username,
            command,
            parameters: args,
            scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date()
        });

        await newCommand.save();

        // Si el agente está online, enviar via WebSocket
        const io = req.app.get('io');
        if (agent.status === 'online' && !scheduledFor) {
            const targetSocket = Array.from(io.of('/').sockets.values())
                .find(socket => socket.agentId === agentId);

            if (targetSocket) {
                targetSocket.emit('command', {
                    commandId: newCommand.commandId,
                    command_type: command,
                    parameters: args,
                    sentBy: req.user.username,
                    timestamp: new Date().toISOString()
                });

                await newCommand.markAsSent();
            }
        }

        res.status(201).json({
            success: true,
            message: 'Comando enviado exitosamente',
            data: {
                commandId: newCommand.commandId,
                status: newCommand.status,
                scheduledFor: newCommand.scheduledFor
            }
        });

    } catch (error) {
        console.error('Error enviando comando:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// POST /control/commands/batch - Enviar comando a múltiples agentes
router.post('/commands/batch', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const { agentIds, command, parameters = {}, priority = 'normal' } = req.body;

        if (!agentIds || !Array.isArray(agentIds) || !command) {
            return res.status(400).json({
                success: false,
                error: 'Lista de Agent IDs y comando son requeridos'
            });
        }

        const results = [];
        const io = req.app.get('io');

        for (const agentId of agentIds) {
            try {
                const agent = await Agent.findOne({ agentId });
                if (!agent) {
                    results.push({
                        agentId,
                        success: false,
                        error: 'Agente no encontrado'
                    });
                    continue;
                }

                const newCommand = new Command({
                    commandId: uuidv4(),
                    agentId,
                    sentBy: req.user.username,
                    command,
                    parameters,
                    priority
                });

                await newCommand.save();

                // Enviar via WebSocket si está online
                if (agent.status === 'online') {
                    const targetSocket = Array.from(io.of('/').sockets.values())
                        .find(socket => socket.agentId === agentId);

                    if (targetSocket) {
                        targetSocket.emit('command', {
                            commandId: newCommand.commandId,
                            command,
                            parameters,
                            priority,
                            sentBy: req.user.username,
                            timestamp: new Date().toISOString()
                        });

                        await newCommand.markAsSent();
                    }
                }

                results.push({
                    agentId,
                    success: true,
                    commandId: newCommand.commandId,
                    status: newCommand.status
                });

            } catch (error) {
                results.push({
                    agentId,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `Comandos enviados a ${results.filter(r => r.success).length} de ${agentIds.length} agentes`,
            data: { results }
        });

    } catch (error) {
        console.error('Error enviando comandos batch:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// GET /control/commands/:commandId - Obtener estado de un comando
router.get('/commands/:commandId', authenticateToken, async (req, res) => {
    try {
        const { commandId } = req.params;

        const command = await Command.findOne({ commandId });
        if (!command) {
            return res.status(404).json({
                success: false,
                error: 'Comando no encontrado'
            });
        }

        res.json({
            success: true,
            data: { command }
        });

    } catch (error) {
        console.error('Error obteniendo comando:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// GET /control/agents/:agentId/commands - Historial de comandos de un agente
router.get('/agents/:agentId/commands', authenticateToken, async (req, res) => {
    try {
        const { agentId } = req.params;
        const { page = 1, limit = 20, status } = req.query;

        let query = { agentId };
        if (status) query.status = status;

        const commands = await Command.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Command.countDocuments(query);

        res.json({
            success: true,
            data: {
                commands,
                pagination: {
                    current: page * 1,
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });

    } catch (error) {
        console.error('Error obteniendo comandos del agente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Comandos específicos predefinidos

// POST /control/volume - Control de volumen
router.post('/volume', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    const { agentId, action, level } = req.body; // action: set/mute/unmute/up/down

    let command, parameters = {};

    switch (action) {
        case 'set':
            command = 'volume_set';
            parameters = { level: level || 50 };
            break;
        case 'mute':
            command = 'volume_mute';
            break;
        case 'unmute':
            command = 'volume_unmute';
            break;
        case 'up':
            command = 'volume_up';
            parameters = { increment: level || 10 };
            break;
        case 'down':
            command = 'volume_down';
            parameters = { decrement: level || 10 };
            break;
        default:
            return res.status(400).json({
                success: false,
                error: 'Acción de volumen inválida'
            });
    }

    // Reutilizar lógica del endpoint principal
    req.body = { agentId, command, parameters, priority: 'normal' };
    return router.stack[0].handle(req, res); // Llamar al primer handler (POST /command)
});

// POST /control/lock - Bloquear/desbloquear pantalla
router.post('/lock', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    const { agentId, action } = req.body; // action: lock/unlock

    const command = action === 'unlock' ? 'unlock_screen' : 'lock_screen';

    req.body = { agentId, command, priority: 'high' };
    return router.stack[0].handle(req, res);
});

// POST /control/power - Control de energía
router.post('/power', authenticateToken, authorizeRole('admin'), async (req, res) => {
    const { agentId, action, delay } = req.body; // action: shutdown/restart/hibernate/sleep

    const validActions = ['shutdown', 'restart', 'hibernate', 'sleep'];
    if (!validActions.includes(action)) {
        return res.status(400).json({
            success: false,
            error: 'Acción de energía inválida'
        });
    }

    const parameters = delay ? { delay: delay * 1000 } : {}; // Convertir a ms

    req.body = { agentId, command: action, parameters, priority: 'urgent' };
    return router.stack[0].handle(req, res);
});

// POST /control/message - Enviar mensaje al usuario
router.post('/message', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    const { agentId, title, message, type = 'info' } = req.body;

    if (!message) {
        return res.status(400).json({
            success: false,
            error: 'Mensaje es requerido'
        });
    }

    const parameters = { title, message, type };

    req.body = { agentId, command: 'send_message', parameters, priority: 'normal' };
    return router.stack[0].handle(req, res);
});

module.exports = router;