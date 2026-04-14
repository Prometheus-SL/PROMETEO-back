const express = require('express');
const { authenticateToken, requireAgentOwnership } = require('../../middleware/auth');
const Agent = require('../../models/Agent');
const AgentData = require('../../models/AgentData');
const { asyncHandler } = require('../../http/asyncHandler');
const { createHttpError } = require('../../http/errors');
const { created, ok } = require('../../http/responses');
const { buildAccessibleAgentQuery } = require('./shared');

const router = express.Router();

router.get('/data/latest', authenticateToken, asyncHandler(async (req, res) => {
    const { agentId, limit = 10, dataType } = req.query;
    const query = await buildAccessibleAgentQuery(req.user, agentId);
    if (dataType) {
        query.dataType = dataType;
    }

    const latestData = await AgentData.find(query)
        .sort({ createdAt: -1 })
        .limit(Number(limit));

    const enrichedData = await Promise.all(latestData.map(async (record) => {
        const agent = await Agent.findOne({ agentId: record.agentId }).select('name agentId location');
        return {
            ...record.toObject(),
            agent: agent ? { name: agent.name, agentId: agent.agentId, location: agent.location } : null,
        };
    }));

    return ok(res, {
        latest: enrichedData,
        count: enrichedData.length,
        timestamp: new Date().toISOString(),
    });
}));

router.get('/agents/:agentId/data', authenticateToken, asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const { startDate, endDate, dataType } = req.query;

    const query = await buildAccessibleAgentQuery(req.user, req.params.agentId);
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (dataType) {
        query.dataType = dataType;
    }

    const [records, total] = await Promise.all([
        AgentData.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit),
        AgentData.countDocuments(query),
    ]);

    return ok(res, {
        agentId: req.params.agentId,
        records,
        pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total,
        },
    });
}));

router.post('/agents/data', authenticateToken, requireAgentOwnership, asyncHandler(async (req, res) => {
    const agent = req.agent;
    const { data, dataType = 'sensor', priority = 'normal', tags = [] } = req.body || {};

    if (!data) {
        throw createHttpError(400, 'AGENT_DATA_REQUIRED', 'data is required');
    }

    const agentData = new AgentData({
        agentId: agent.agentId,
        data,
        dataType,
        priority,
        tags,
        metadata: {
            socketId: req.headers['x-socket-id'],
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
        },
    });
    await agentData.save();

    agent.lastData = new Date();
    await agent.save();

    req.app.get('io').to('frontend').emit('agent-data', {
        agentId: agent.agentId,
        data,
        dataType,
        priority,
        tags,
        timestamp: agentData.createdAt,
    });

    return created(res, {
        id: agentData._id,
        timestamp: agentData.createdAt,
    }, {
        message: 'Agent data stored successfully',
    });
}));

module.exports = router;
