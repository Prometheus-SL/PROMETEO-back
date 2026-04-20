const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
    ensureClient,
    getStatus,
    fetchConversations,
    fetchMessages,
    sendMessage,
} = require('../services/whatsapp/client');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');

const router = express.Router();

function parseLimit(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.min(num, 50);
}

router.get('/status', authenticateToken, asyncHandler(async (req, res) => {
    await ensureClient(req.user);
    return ok(res, getStatus(req.user));
}));

router.get('/conversations', authenticateToken, asyncHandler(async (req, res) => {
    const limit = parseLimit(req.query.limit, 8);
    const includeGroups = req.query.includeGroups !== 'false';
    const data = await fetchConversations(req.user, limit, { includeGroups });
    return ok(res, data);
}));

router.get('/conversations/:chatId/messages', authenticateToken, asyncHandler(async (req, res) => {
    const limit = parseLimit(req.query.limit, 20);
    const data = await fetchMessages(req.user, req.params.chatId, limit);
    return ok(res, data);
}));

router.post('/conversations/:chatId/messages', authenticateToken, asyncHandler(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) throw createHttpError(400, 'WHATSAPP_TEXT_REQUIRED', 'text is required.');
    if (text.length > 4096) throw createHttpError(400, 'WHATSAPP_TEXT_TOO_LONG', 'text must be 4096 characters or less.');
    const result = await sendMessage(req.user, req.params.chatId, text);
    return ok(res, result, { message: 'Message sent.' });
}));

module.exports = router;
