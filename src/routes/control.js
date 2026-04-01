const express = require('express');
const { randomUUID } = require('crypto');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const Agent = require('../models/Agent');
const Command = require('../models/Command');

const router = express.Router();

function getConnectedAgentSocket(io, agentId) {
    return Array.from(io.of('/').sockets.values()).find(
        (socket) => socket.agentId === agentId && socket.data?.clientType === 'agent' && socket.data?.isAuthenticatedAgent
    );
}

function buildRealtimeCommand(commandDoc, userName) {
    return {
        commandId: commandDoc.commandId,
        command_type: commandDoc.command,
        command: commandDoc.command,
        parameters: commandDoc.parameters,
        priority: commandDoc.priority,
        sentBy: userName,
        timestamp: new Date().toISOString()
    };
}

async function createCommandRecord({ agentId, command, parameters = {}, priority = 'normal', scheduledFor, sentBy }) {
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : new Date();
    if (Number.isNaN(scheduledDate.getTime())) {
        const error = new Error('Fecha programada inválida');
        error.status = 400;
        throw error;
    }

    const commandDoc = new Command({
        commandId: randomUUID(),
        agentId,
        sentBy,
        command,
        parameters,
        priority,
        scheduledFor: scheduledDate
    });

    await commandDoc.save();
    return commandDoc;
}

async function dispatchIfOnline(req, agent, commandDoc) {
    if (agent.status !== 'online' || commandDoc.scheduledFor > new Date()) {
        return false;
    }

    const io = req.app.get('io');
    const targetSocket = getConnectedAgentSocket(io, agent.agentId);
    if (!targetSocket) {
        return false;
    }

    targetSocket.emit('command', buildRealtimeCommand(commandDoc, req.user.username));
    await commandDoc.markAsSent();
    return true;
}

async function handleSingleCommand(req, res, payload = req.body || {}) {
    const {
        agentId,
        command,
        args = {},
        parameters,
        priority = 'normal',
        scheduledFor
    } = payload || {};

    if (!agentId || !command) {
        return res.status(400).json({
            success: false,
            error: 'Agent ID y comando son requeridos'
        });
    }

    const agent = await Agent.findOne({ agentId, isActive: { $ne: false } });
    if (!agent) {
        return res.status(404).json({
            success: false,
            error: 'Agente no encontrado'
        });
    }

    if (!scheduledFor && agent.status !== 'online') {
        return res.status(400).json({
            success: false,
            error: 'El agente debe estar online para enviar comandos inmediatos'
        });
    }

    const commandParameters = parameters !== undefined ? parameters : args;
    const newCommand = await createCommandRecord({
        agentId,
        command,
        parameters: commandParameters,
        priority,
        scheduledFor,
        sentBy: req.user.username
    });

    await dispatchIfOnline(req, agent, newCommand);

    return res.status(201).json({
        success: true,
        message: 'Comando enviado exitosamente',
        data: {
            commandId: newCommand.commandId,
            status: newCommand.status,
            priority: newCommand.priority,
            scheduledFor: newCommand.scheduledFor
        }
    });
}

router.post('/command', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        return await handleSingleCommand(req, res);
    } catch (error) {
        console.error('Error enviando comando:', error);
        res.status(error.status || 500).json({
            success: false,
            error: error.message || 'Error interno del servidor'
        });
    }
});

router.post('/commands/batch', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const { agentIds, command, parameters = {}, priority = 'normal' } = req.body || {};

        if (!Array.isArray(agentIds) || agentIds.length === 0 || !command) {
            return res.status(400).json({
                success: false,
                error: 'Lista de Agent IDs y comando son requeridos'
            });
        }

        const results = [];

        for (const agentId of agentIds) {
            try {
                const agent = await Agent.findOne({ agentId, isActive: { $ne: false } });
                if (!agent) {
                    results.push({
                        agentId,
                        success: false,
                        error: 'Agente no encontrado'
                    });
                    continue;
                }

                const newCommand = await createCommandRecord({
                    agentId,
                    command,
                    parameters,
                    priority,
                    sentBy: req.user.username
                });

                await dispatchIfOnline(req, agent, newCommand);

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
            message: `Comandos enviados a ${results.filter((result) => result.success).length} de ${agentIds.length} agentes`,
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

router.get('/agents/:agentId/commands', authenticateToken, async (req, res) => {
    try {
        const { agentId } = req.params;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const { status } = req.query;

        const query = { agentId };
        if (status) query.status = status;

        const commands = await Command.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit);

        const total = await Command.countDocuments(query);

        res.json({
            success: true,
            data: {
                commands,
                pagination: {
                    current: page,
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

router.post('/message', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const { agentId, title, message, type = 'info' } = req.body || {};

        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Mensaje es requerido'
            });
        }

        return await handleSingleCommand(req, res, {
            agentId,
            command: 'send_message',
            parameters: { title, message, type },
            priority: 'normal'
        });
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        return res.status(error.status || 500).json({
            success: false,
            error: error.message || 'Error interno del servidor'
        });
    }
});

module.exports = router;
