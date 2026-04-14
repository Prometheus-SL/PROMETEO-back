const mongoose = require('mongoose');
const Agent = require('../../models/Agent');
const { createHttpError } = require('../../http/errors');

const ALLOWED_USER_ROLES = ['admin', 'operator', 'viewer', 'user'];

function canReadAllAgents(user) {
    return ['admin', 'operator'].includes(user?.role);
}

async function getOwnedAgentIds(userId) {
    const agents = await Agent.find({ user: userId }).select('agentId').lean();
    return agents.map((agent) => agent.agentId);
}

async function buildAccessibleAgentQuery(user, requestedAgentId) {
    if (canReadAllAgents(user)) {
        return requestedAgentId ? { agentId: requestedAgentId } : {};
    }

    const ownedAgentIds = await getOwnedAgentIds(user._id);
    if (requestedAgentId && !ownedAgentIds.includes(requestedAgentId)) {
        throw createHttpError(403, 'AGENT_READ_FORBIDDEN', 'You do not have permission to view this agent');
    }

    return requestedAgentId
        ? { agentId: requestedAgentId }
        : { agentId: { $in: ownedAgentIds } };
}

function assertObjectId(value, code = 'INVALID_ID', message = 'Invalid id') {
    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw createHttpError(400, code, message);
    }
}

module.exports = {
    ALLOWED_USER_ROLES,
    assertObjectId,
    buildAccessibleAgentQuery,
    canReadAllAgents,
};
