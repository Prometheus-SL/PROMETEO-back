const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { initBot, getStatus, getGuildInfo, getInviteUrl } = require('../services/discord/client');

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
