const AUDIO_COMMANDS = new Set([
    'volume_set',
    'volume_mute',
    'volume_unmute',
    'volume_up',
    'volume_down',
    'audio_output_set',
    'get_audio_state',
]);

const MEDIA_COMMANDS = new Set([
    'media_refresh',
    'media_toggle_playback',
    'media_play',
    'media_pause',
    'media_next',
    'media_previous',
]);

function getAuthenticatedAgentSockets(io, agentId) {
    return Array.from(io.of('/').sockets.values()).filter(
        (socket) => socket.agentId === agentId && socket.data?.clientType === 'agent' && socket.data?.isAuthenticatedAgent
    );
}

function scoreSocket(socket, commandName = '') {
    const normalizedCommand = String(commandName || '');
    const socketMode = String(socket.data?.agentMode || '');
    const connectedAt = Number(socket.data?.connectedAt || 0);

    if (AUDIO_COMMANDS.has(normalizedCommand)) {
        return (
            (socket.data?.audioAvailable ? 10 : 0) +
            (socketMode === 'manual' ? 5 : 0) +
            connectedAt
        );
    }

    if (MEDIA_COMMANDS.has(normalizedCommand)) {
        return (
            (socket.data?.mediaAvailable ? 15 : 0) +
            (socketMode === 'service' ? 5 : 0) +
            connectedAt
        );
    }

    return (socketMode === 'service' ? 5 : 0) + connectedAt;
}

function selectConnectedAgentSocket(io, agentId, commandName = '') {
    const sockets = getAuthenticatedAgentSockets(io, agentId);
    if (sockets.length === 0) {
        return null;
    }

    return [...sockets].sort((left, right) => scoreSocket(right, commandName) - scoreSocket(left, commandName))[0] || null;
}

function listConnectedSocketSummaries(io) {
    return Array.from(io.of('/').sockets.values()).map((socket) => ({
        id: socket.id,
        connected: socket.connected,
        rooms: Array.from(socket.rooms),
        agentId: socket.agentId || null,
    }));
}

module.exports = {
    getAuthenticatedAgentSockets,
    listConnectedSocketSummaries,
    selectConnectedAgentSocket,
};
