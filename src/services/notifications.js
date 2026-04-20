let ioInstance = null;

function setIo(io) {
    ioInstance = io;
}

function getIo() {
    return ioInstance;
}

function notifyUser(userId, event, payload) {
    if (!ioInstance) return;
    ioInstance.to(`frontend:user:${String(userId)}`).emit(event, payload);
}

function notifyAdmins(event, payload) {
    if (!ioInstance) return;
    ioInstance.to('frontend:admins').emit(event, payload);
}

function notifyAll(event, payload) {
    if (!ioInstance) return;
    ioInstance.to('frontend').emit(event, payload);
}

function broadcast(event, payload, ownerUserId) {
    if (!ioInstance) return;
    if (ownerUserId) {
        ioInstance.to('frontend:admins').to(`frontend:user:${String(ownerUserId)}`).emit(event, payload);
    } else {
        ioInstance.to('frontend:admins').emit(event, payload);
    }
}

module.exports = { setIo, getIo, notifyUser, notifyAdmins, notifyAll, broadcast };
