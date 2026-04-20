const express = require('express');
const AgentGroup = require('../../models/AgentGroup');
const Agent = require('../../models/Agent');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../http/asyncHandler');
const { createHttpError } = require('../../http/errors');
const { ok, created } = require('../../http/responses');

const router = express.Router();
const groupCollectionPaths = ['/groups', '/agents/groups'];
const groupItemPaths = ['/groups/:groupId', '/agents/groups/:groupId'];

function buildAgentQuery(user) {
    if (['admin', 'operator'].includes(user.role)) {
        return {};
    }
    return { user: user._id };
}

router.get(groupCollectionPaths, authenticateToken, asyncHandler(async (req, res) => {
    const groups = await AgentGroup.find({ owner: req.user._id })
        .sort({ createdAt: -1 })
        .lean();

    return ok(res, { groups });
}));

router.post(groupCollectionPaths, authenticateToken, asyncHandler(async (req, res) => {
    const { name, description, agents, color } = req.body || {};

    if (!name || typeof name !== 'string') {
        throw createHttpError(400, 'GROUP_NAME_REQUIRED', 'Group name is required');
    }

    if (agents && Array.isArray(agents) && agents.length > 0) {
        const ownedAgents = await Agent.find({
            agentId: { $in: agents },
            ...buildAgentQuery(req.user),
        }).select('agentId');
        const ownedIds = new Set(ownedAgents.map((a) => a.agentId));
        const invalid = agents.filter((id) => !ownedIds.has(id));
        if (invalid.length > 0) {
            throw createHttpError(403, 'AGENT_ACCESS_DENIED', `Not authorized for agents: ${invalid.join(', ')}`);
        }
    }

    const group = await AgentGroup.create({
        name: name.trim(),
        description: description || '',
        owner: req.user._id,
        agents: agents || [],
        color: color || undefined,
    });

    return created(res, { group }, { message: 'Group created' });
}));

router.patch(groupItemPaths, authenticateToken, asyncHandler(async (req, res) => {
    const group = await AgentGroup.findOne({ _id: req.params.groupId, owner: req.user._id });
    if (!group) {
        throw createHttpError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    const { name, description, agents, color } = req.body || {};

    if (name !== undefined) group.name = String(name).trim();
    if (description !== undefined) group.description = String(description);
    if (color !== undefined) group.color = color;

    if (agents !== undefined && Array.isArray(agents)) {
        const ownedAgents = await Agent.find({
            agentId: { $in: agents },
            ...buildAgentQuery(req.user),
        }).select('agentId');
        const ownedIds = new Set(ownedAgents.map((a) => a.agentId));
        const invalid = agents.filter((id) => !ownedIds.has(id));
        if (invalid.length > 0) {
            throw createHttpError(403, 'AGENT_ACCESS_DENIED', `Not authorized for agents: ${invalid.join(', ')}`);
        }
        group.agents = agents;
    }

    await group.save();
    return ok(res, { group }, { message: 'Group updated' });
}));

router.delete(groupItemPaths, authenticateToken, asyncHandler(async (req, res) => {
    const group = await AgentGroup.findOneAndDelete({ _id: req.params.groupId, owner: req.user._id });
    if (!group) {
        throw createHttpError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    return ok(res, null, { message: 'Group deleted' });
}));

module.exports = router;
