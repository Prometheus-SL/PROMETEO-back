const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
    ensureClient,
    getStatus,
    fetchConversations,
    fetchMessages,
} = require('../services/whatsapp/client');

const router = express.Router();

function parseLimit(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.min(num, 50);
}

function sendError(res, error) {
    const status = error?.status ?? (error?.code === 'CLIENT_NOT_READY' ? 409 : 500);
    const message = error?.message ?? 'Error interno del servidor';
    res.status(status).json({ success: false, error: message });
}

router.get('/status', authenticateToken, async (_req, res) => {
    try {
        await ensureClient();
        res.json({ success: true, data: getStatus() });
    } catch (error) {
        sendError(res, error);
    }
});

router.get('/conversations', authenticateToken, async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, 8);
        const includeGroups = req.query.includeGroups !== 'false';
        const data = await fetchConversations(limit, { includeGroups });
        res.json({ success: true, data });
    } catch (error) {
        sendError(res, error);
    }
});

router.get('/conversations/:chatId/messages', authenticateToken, async (req, res) => {
    try {
        const limit = parseLimit(req.query.limit, 20);
        const data = await fetchMessages(req.params.chatId, limit);
        res.json({ success: true, data });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
