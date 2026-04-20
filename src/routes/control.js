const express = require('express');
const { randomUUID } = require('crypto');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const Agent = require('../models/Agent');
const Command = require('../models/Command');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { created, ok } = require('../http/responses');
const { selectConnectedAgentSocket } = require('../services/socketAgents');

const router = express.Router();
const CONTROL_ROLES = ['admin', 'operator', 'user'];

function buildRealtimeCommand(commandDoc, userName) {
    return {
        commandId: commandDoc.commandId,
        command_type: commandDoc.command,
        command: commandDoc.command,
        parameters: commandDoc.parameters,
        priority: commandDoc.priority,
        sentBy: userName,
        timestamp: new Date().toISOString(),
    };
}

function canControlAllAgents(user) {
    return ['admin', 'operator'].includes(user?.role);
}

function ensureControlRole(user) {
    if (CONTROL_ROLES.includes(user?.role)) {
        return;
    }

    throw createHttpError(403, 'AGENT_CONTROL_FORBIDDEN', 'You do not have permission to control agents');
}

async function getControllableAgent(user, agentId) {
    ensureControlRole(user);

    if (!agentId) {
        throw createHttpError(400, 'AGENT_ID_REQUIRED', 'Agent ID is required');
    }

    const agent = await Agent.findOne({ agentId, isActive: { $ne: false } });
    if (!agent) {
        throw createHttpError(404, 'AGENT_NOT_FOUND', 'Agent not found');
    }

    if (!canControlAllAgents(user) && String(agent.user) !== String(user._id)) {
        throw createHttpError(403, 'AGENT_CONTROL_FORBIDDEN', 'You do not have permission to control this agent');
    }

    return agent;
}

async function createCommandRecord({ agentId, command, parameters = {}, priority = 'normal', scheduledFor, sentBy }) {
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : new Date();
    if (Number.isNaN(scheduledDate.getTime())) {
        throw createHttpError(400, 'INVALID_SCHEDULED_FOR', 'scheduledFor must be a valid date');
    }

    const commandDoc = new Command({
        commandId: randomUUID(),
        agentId,
        sentBy,
        command,
        parameters,
        priority,
        scheduledFor: scheduledDate,
    });

    await commandDoc.save();
    return commandDoc;
}

function addCommandListFilters(query, filters = {}) {
    const { status, command: commandType, from, to } = filters;

    if (status) {
        query.status = status;
    }
    if (commandType) {
        query.command = commandType;
    }
    if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(from);
        if (to) query.createdAt.$lte = new Date(to);
    }

    return query;
}

async function buildCommandListQuery(user, filters = {}, agentId = null) {
    ensureControlRole(user);

    const query = addCommandListFilters({}, filters);
    if (agentId) {
        query.agentId = agentId;
        return query;
    }

    if (!canControlAllAgents(user)) {
        const agents = await Agent.find({
            user: user._id,
            isActive: { $ne: false },
        }).select('agentId');
        query.agentId = { $in: agents.map((agent) => agent.agentId) };
    }

    return query;
}

async function listCommands(query, page, limit) {
    const commands = await Command.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip((page - 1) * limit);

    const total = await Command.countDocuments(query);

    return {
        commands,
        pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total,
        },
    };
}

async function dispatchIfOnline(req, agent, commandDoc) {
    if (agent.status !== 'online' || commandDoc.scheduledFor > new Date()) {
        return false;
    }

    const io = req.app.get('io');
    const targetSocket = selectConnectedAgentSocket(io, agent.agentId, commandDoc.command);
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
        scheduledFor,
    } = payload || {};

    if (!agentId || !command) {
        throw createHttpError(400, 'COMMAND_PAYLOAD_INVALID', 'Agent ID and command are required');
    }

    const agent = await getControllableAgent(req.user, agentId);

    if (!scheduledFor && agent.status !== 'online') {
        throw createHttpError(400, 'AGENT_OFFLINE', 'The agent must be online for immediate commands');
    }

    const commandParameters = parameters !== undefined ? parameters : args;
    const commandDoc = await createCommandRecord({
        agentId,
        command,
        parameters: commandParameters,
        priority,
        scheduledFor,
        sentBy: req.user.username,
    });

    await dispatchIfOnline(req, agent, commandDoc);

    return created(res, {
        commandId: commandDoc.commandId,
        status: commandDoc.status,
        priority: commandDoc.priority,
        scheduledFor: commandDoc.scheduledFor,
    }, {
        message: 'Command queued successfully',
    });
}

router.post('/command', authenticateToken, asyncHandler(async (req, res) => {
    return handleSingleCommand(req, res);
}));

router.post('/commands/batch', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const { agentIds, command, parameters = {}, priority = 'normal' } = req.body || {};

    if (!Array.isArray(agentIds) || agentIds.length === 0 || !command) {
        throw createHttpError(400, 'BATCH_COMMAND_PAYLOAD_INVALID', 'agentIds and command are required');
    }

    const results = [];

    for (const agentId of agentIds) {
        try {
            const agent = await getControllableAgent(req.user, agentId);
            const commandDoc = await createCommandRecord({
                agentId,
                command,
                parameters,
                priority,
                sentBy: req.user.username,
            });

            await dispatchIfOnline(req, agent, commandDoc);

            results.push({
                agentId,
                success: true,
                commandId: commandDoc.commandId,
                status: commandDoc.status,
            });
        } catch (error) {
            results.push({
                agentId,
                success: false,
                error: error.message,
                code: error.code || 'COMMAND_FAILED',
            });
        }
    }

    return ok(res, { results }, {
        message: `Commands queued for ${results.filter((item) => item.success).length} of ${agentIds.length} agents`,
    });
}));

router.get('/commands', authenticateToken, asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const query = await buildCommandListQuery(req.user, req.query);

    return ok(res, await listCommands(query, page, limit));
}));

router.get('/commands/:commandId', authenticateToken, asyncHandler(async (req, res) => {
    const command = await Command.findOne({ commandId: req.params.commandId });
    if (!command) {
        throw createHttpError(404, 'COMMAND_NOT_FOUND', 'Command not found');
    }

    if (!canControlAllAgents(req.user)) {
        await getControllableAgent(req.user, command.agentId);
    }

    return ok(res, { command });
}));

router.post('/commands/:commandId/cancel', authenticateToken, asyncHandler(async (req, res) => {
    const command = await Command.findOne({ commandId: req.params.commandId });
    if (!command) {
        throw createHttpError(404, 'COMMAND_NOT_FOUND', 'Command not found');
    }

    if (!canControlAllAgents(req.user)) {
        await getControllableAgent(req.user, command.agentId);
    }

    const reason = req.body?.reason || 'Cancelled by user';
    const result = await command.cancel(reason);
    if (!result) {
        throw createHttpError(400, 'COMMAND_NOT_CANCELLABLE', 'Command cannot be cancelled in its current state');
    }

    const io = req.app.get('io');
    if (io) {
        const targetSocket = selectConnectedAgentSocket(io, command.agentId, command.command);
        if (targetSocket) {
            targetSocket.emit('command-cancel', { commandId: command.commandId, reason });
        }
    }

    return ok(res, { command: result }, { message: 'Command cancelled' });
}));

router.get('/agents/:agentId/commands', authenticateToken, asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    await getControllableAgent(req.user, agentId);

    const query = await buildCommandListQuery(req.user, req.query, agentId);

    return ok(res, await listCommands(query, page, limit));
}));

router.post('/message', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const { agentId, title, message, type = 'info' } = req.body || {};

    if (!message) {
        throw createHttpError(400, 'MESSAGE_REQUIRED', 'message is required');
    }

    return handleSingleCommand(req, res, {
        agentId,
        command: 'send_message',
        parameters: { title, message, type },
        priority: 'normal',
    });
}));

module.exports = router;
