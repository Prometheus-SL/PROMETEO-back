const express = require('express');
const { randomBytes } = require('crypto');
const { authenticateToken, authorizeRole } = require('../../middleware/auth');
const Agent = require('../../models/Agent');
const AgentData = require('../../models/AgentData');
const User = require('../../models/User');
const { asyncHandler } = require('../../http/asyncHandler');
const { createHttpError } = require('../../http/errors');
const { created, ok } = require('../../http/responses');
const { listConnectedSocketSummaries, selectConnectedAgentSocket } = require('../../services/socketAgents');
const { hashApiKey } = require('../../services/agentApiKey');
const { assertObjectId } = require('./shared');

const router = express.Router();

function sortDateLikeDesc(items, fields) {
    return [...items].sort((left, right) => {
        for (const field of fields) {
            const leftValue = left?.[field] ? new Date(left[field]).getTime() : 0;
            const rightValue = right?.[field] ? new Date(right[field]).getTime() : 0;
            if (leftValue !== rightValue) {
                return rightValue - leftValue;
            }
        }

        return 0;
    });
}

async function resolveSortedResults(queryLike, sortSpec, limit) {
    if (queryLike && typeof queryLike.sort === 'function' && !Array.isArray(queryLike)) {
        const sortedQuery = queryLike.sort(sortSpec);
        if (typeof limit === 'number' && typeof sortedQuery?.limit === 'function') {
            return sortedQuery.limit(limit);
        }

        return sortedQuery;
    }

    const resolved = await queryLike;
    if (!Array.isArray(resolved)) {
        return resolved;
    }

    const ordered = sortDateLikeDesc(resolved, Object.keys(sortSpec || {}));
    return typeof limit === 'number' ? ordered.slice(0, limit) : ordered;
}

function buildAgentScope(req) {
    if (req.user.role === 'admin' || req.user.role === 'operator') {
        return {};
    }

    return { user: req.user._id };
}

function normalizePercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function getAgentHealthSnapshot(agent, latestData) {
    const resources = latestData?.data?.resources || {};
    const diskPercent = Array.isArray(resources.disks) && resources.disks.length > 0
        ? normalizePercent(resources.disks[0]?.percent)
        : null;
    const cpuPercent = normalizePercent(resources.cpu?.percent);
    const memoryPercent = normalizePercent(resources.memory?.percent);
    const degraded = agent.status !== 'online'
        || [cpuPercent, memoryPercent, diskPercent].some((value) => typeof value === 'number' && value >= 85);

    return {
        agentId: agent.agentId,
        name: agent.name,
        status: agent.status || 'offline',
        hostname: agent.computerInfo?.hostname || latestData?.data?.system?.hostname || null,
        lastSeen: agent.lastSeen || null,
        latestTelemetryAt: latestData?.createdAt || agent.lastData || null,
        health: {
            cpuPercent,
            memoryPercent,
            diskPercent,
        },
        degraded,
    };
}

router.get('/agents', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const io = req.app.get('io');
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const { status, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (search) {
        query.$or = [
            { agentId: { $regex: search, $options: 'i' } },
            { name: { $regex: search, $options: 'i' } },
        ];
    }

    const [agents, total] = await Promise.all([
        Agent.find(query)
            .select('-apiKey')
            .populate('user', 'username email name surname')
            .limit(limit)
            .skip((page - 1) * limit)
            .sort({ lastSeen: -1 }),
        Agent.countDocuments(query),
    ]);

    return ok(res, {
        agents,
        pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total,
        },
        connections: {
            total: io.of('/').sockets.size,
            sockets: listConnectedSocketSummaries(io),
        },
    });
}));

router.get('/agents/me', authenticateToken, asyncHandler(async (req, res) => {
    const agents = await Agent.find({ user: req.user._id })
        .select('-apiKey')
        .sort({ lastSeen: -1, createdAt: -1 });

    return ok(res, {
        agents,
        total: agents.length,
    });
}));

router.get('/stats', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const io = req.app.get('io');

    const [totalAgents, activeAgents, totalUsers, totalData] = await Promise.all([
        Agent.countDocuments(),
        Agent.countDocuments({ status: 'online' }),
        User.countDocuments({ isActive: true }),
        AgentData.countDocuments(),
    ]);

    return ok(res, {
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
            version: '1.0.0',
        },
        connections: {
            total: io.of('/').sockets.size,
            agents: io.sockets.adapter.rooms.get('agents')?.size || 0,
            frontend: io.sockets.adapter.rooms.get('frontend')?.size || 0,
        },
        database: {
            totalAgents,
            activeAgents,
            totalUsers,
            totalData,
        },
    });
}));

router.post('/agents/command', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const io = req.app.get('io');
    const { command, args, agentId } = req.body || {};

    if (!command) {
        throw createHttpError(400, 'COMMAND_REQUIRED', 'Command is required');
    }

    const commandData = {
        command_type: command,
        parameters: args,
        timestamp: new Date().toISOString(),
        sentBy: req.user.username,
    };

    if (agentId) {
        const targetSocket = selectConnectedAgentSocket(io, agentId, command);
        if (!targetSocket) {
            throw createHttpError(404, 'AGENT_NOT_CONNECTED', `Agent ${agentId} was not found or is offline`);
        }

        targetSocket.emit('command', commandData);
        return ok(res, {
            timestamp: commandData.timestamp,
        }, {
            message: `Command '${command}' sent to agent ${agentId}`,
        });
    }

    io.to('agents').emit('command', commandData);
    return ok(res, {
        timestamp: commandData.timestamp,
    }, {
        message: `Command '${command}' sent to all connected agents`,
    });
}));

router.get('/agents/health', authenticateToken, asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const scope = buildAgentScope(req);
    const agents = await resolveSortedResults(Agent.find(scope), { lastSeen: -1, createdAt: -1 }, limit);
    const agentIds = Array.isArray(agents) ? agents.map((agent) => agent.agentId).filter(Boolean) : [];

    let latestEntries = [];
    if (agentIds.length > 0) {
        latestEntries = await resolveSortedResults(
            AgentData.find({
                agentId: { $in: agentIds },
                dataType: 'system_status',
            }),
            { createdAt: -1 },
            agentIds.length * 3
        );
    }

    const latestByAgent = new Map();
    for (const entry of Array.isArray(latestEntries) ? latestEntries : []) {
        if (!latestByAgent.has(entry.agentId)) {
            latestByAgent.set(entry.agentId, entry);
        }
    }

    const summarizedAgents = (Array.isArray(agents) ? agents : []).map((agent) => (
        getAgentHealthSnapshot(agent, latestByAgent.get(agent.agentId))
    ));

    return ok(res, {
        summary: {
            total: summarizedAgents.length,
            online: summarizedAgents.filter((agent) => agent.status === 'online').length,
            degraded: summarizedAgents.filter((agent) => agent.degraded).length,
        },
        agents: summarizedAgents,
    });
}));

router.get('/agents/:userId', authenticateToken, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    assertObjectId(userId, 'INVALID_USER_ID', 'Invalid user id');

    if (req.user.role !== 'admin' && String(req.user._id) !== userId) {
        throw createHttpError(403, 'AGENT_READ_FORBIDDEN', 'You do not have permission to view agents for this user');
    }

    const agents = await Agent.find({ user: userId })
        .select('-apiKey')
        .populate('user', 'username email name surname');

    if (agents.length === 0) {
        throw createHttpError(404, 'AGENTS_NOT_FOUND', 'No agents were found for this user');
    }

    return ok(res, agents);
}));

router.post('/agents', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    const { agentId, name, description, location } = req.body || {};

    if (!agentId || !name) {
        throw createHttpError(400, 'AGENT_FIELDS_REQUIRED', 'agentId and name are required');
    }

    const existingAgent = await Agent.findOne({ agentId });
    if (existingAgent) {
        throw createHttpError(409, 'AGENT_ALREADY_EXISTS', 'Agent ID already exists');
    }

    const apiKey = randomBytes(32).toString('hex');
    const newAgent = new Agent({
        agentId,
        name,
        description,
        apiKey: hashApiKey(apiKey),
        location,
        status: 'offline',
    });
    await newAgent.save();

    return created(res, {
        agent: {
            id: newAgent._id,
            agentId: newAgent.agentId,
            name: newAgent.name,
            description: newAgent.description,
            // Única vez que se devuelve la clave en claro: en reposo solo queda el hash.
            apiKey,
            status: newAgent.status,
            location: newAgent.location,
        },
    }, {
        message: 'Agent registered successfully',
    });
}));

router.patch('/agents/:agentId', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const updates = req.body || {};
    const allowedUpdates = ['name', 'description', 'status', 'location', 'metadata'];
    const actualUpdates = {};

    for (const field of allowedUpdates) {
        if (updates[field] !== undefined) {
            actualUpdates[field] = updates[field];
        }
    }

    const agent = await Agent.findOneAndUpdate(
        { agentId: req.params.agentId },
        actualUpdates,
        { new: true, runValidators: true }
    ).select('-apiKey').populate('user', 'username email name surname');

    if (!agent) {
        throw createHttpError(404, 'AGENT_NOT_FOUND', 'Agent not found');
    }

    return ok(res, { agent }, { message: 'Agent updated successfully' });
}));

router.get('/agents/:agentId', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const agent = await Agent.findOne({ agentId: req.params.agentId })
        .select('-apiKey')
        .populate('user', 'username email name surname');

    if (!agent) {
        throw createHttpError(404, 'AGENT_NOT_FOUND', 'Agent not found');
    }

    const latestData = await AgentData.find({ agentId: req.params.agentId })
        .sort({ createdAt: -1 })
        .limit(5);

    return ok(res, {
        agent,
        latestData,
        status: agent.status,
    });
}));

router.delete('/agents/:agentId', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    const agent = await Agent.findOneAndDelete({ agentId: req.params.agentId });
    if (!agent) {
        throw createHttpError(404, 'AGENT_NOT_FOUND', 'Agent not found');
    }

    return ok(res, null, { message: 'Agent deleted successfully' });
}));

router.get('/agents/:agentId/stats', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const days = Number(req.query.days) || 7;

    const agent = await Agent.findOne({ agentId }).select('name agentId status lastSeen');
    if (!agent) {
        throw createHttpError(404, 'AGENT_NOT_FOUND', 'Agent not found');
    }

    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const [totalData, dataByType, recentActivity] = await Promise.all([
        AgentData.countDocuments({
            agentId,
            createdAt: { $gte: startDate },
        }),
        AgentData.aggregate([
            { $match: { agentId, createdAt: { $gte: startDate } } },
            { $group: { _id: '$dataType', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        AgentData.aggregate([
            { $match: { agentId, createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                        },
                    },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
    ]);

    return ok(res, {
        agent,
        stats: {
            totalData,
            dataByType,
            recentActivity,
            period: `${days} days`,
        },
    });
}));

router.post('/agents/batch/status', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const { agentIds, isActive } = req.body || {};
    if (!Array.isArray(agentIds) || agentIds.length === 0 || typeof isActive !== 'boolean') {
        throw createHttpError(400, 'BATCH_PAYLOAD_INVALID', 'agentIds (array) and isActive (boolean) are required');
    }

    const result = await Agent.updateMany(
        { agentId: { $in: agentIds } },
        { $set: { isActive } }
    );

    return ok(res, { modified: result.modifiedCount, total: agentIds.length }, { message: 'Batch agent status updated' });
}));

module.exports = router;
