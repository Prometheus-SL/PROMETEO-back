const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { initBot, getStatus, getGuildInfo, getInviteUrl, disconnectVoiceMember, setVoiceMute } = require('../services/discord/client');

const router = express.Router();

function sendError(res, error) {
    const status = error?.status ?? (error?.code === 'BOT_NOT_READY' ? 503 : 500);
    const message = error?.message ?? 'Error interno del servidor';
    res.status(status).json({ success: false, error: message });
}

// Middleware: inicia el bot bajo demanda si no está conectado
async function ensureBot(_req, res, next) {
    try {
        await initBot();
        next();
    } catch (error) {
        sendError(res, error);
    }
}

// Estado del bot y lista de servidores
router.get('/status', authenticateToken, ensureBot, async (_req, res) => {
    try {
        res.json({ success: true, data: getStatus() });
    } catch (error) {
        sendError(res, error);
    }
});

// Info detallada de un servidor (canales, miembros, presencias)
router.get('/guilds/:guildId', authenticateToken, ensureBot, async (req, res) => {
    try {
        const data = await getGuildInfo(req.params.guildId);
        res.json({ success: true, data });
    } catch (error) {
        sendError(res, error);
    }
});

// Desconectar a un miembro de su canal de voz actual
router.post('/guilds/:guildId/voice/:userId/disconnect', authenticateToken, ensureBot, async (req, res) => {
    try {
        const data = await disconnectVoiceMember(req.params.guildId, req.params.userId);
        res.json({ success: true, data });
    } catch (error) {
        sendError(res, error);
    }
});

// Mutear/desmutear a un miembro en su canal de voz actual
router.post('/guilds/:guildId/voice/:userId/mute', authenticateToken, ensureBot, async (req, res) => {
    try {
        const mute = req.body?.mute !== false;
        const data = await setVoiceMute(req.params.guildId, req.params.userId, mute);
        res.json({ success: true, data });
    } catch (error) {
        sendError(res, error);
    }
});

// URL de invitación para añadir el bot a un servidor
router.get('/invite', authenticateToken, ensureBot, async (_req, res) => {
    try {
        const url = getInviteUrl();
        if (!url) return res.status(503).json({ success: false, error: 'Bot no conectado' });
        res.json({ success: true, data: { url } });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
