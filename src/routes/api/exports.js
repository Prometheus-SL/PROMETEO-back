const express = require('express');
const { authenticateToken, authorizeRole } = require('../../middleware/auth');
const Agent = require('../../models/Agent');
const User = require('../../models/User');
const Command = require('../../models/Command');
const { asyncHandler } = require('../../http/asyncHandler');
const { createHttpError } = require('../../http/errors');

const router = express.Router();

function toCsvRow(obj, columns) {
    return columns.map((col) => {
        const val = obj[col];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    }).join(',');
}

function sendCsv(res, data, columns, filename) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.write(columns.join(',') + '\n');
    for (const row of data) {
        res.write(toCsvRow(row, columns) + '\n');
    }
    res.end();
}

function sendJson(res, data, filename) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
}

router.get('/export/agents', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const agents = await Agent.find()
        .select('-apiKey -__v')
        .lean();

    if (format === 'csv') {
        const columns = ['agentId', 'name', 'status', 'isActive', 'lastSeen', 'createdAt'];
        return sendCsv(res, agents, columns, 'agents.csv');
    }

    return sendJson(res, agents, 'agents.json');
}));

router.get('/export/users', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const users = await User.find()
        .select('-password -refreshTokens -tokenInvalidBefore -__v')
        .lean();

    if (format === 'csv') {
        const columns = ['username', 'email', 'role', 'isActive', 'lastLogin', 'createdAt'];
        return sendCsv(res, users, columns, 'users.csv');
    }

    return sendJson(res, users, 'users.json');
}));

router.get('/export/commands', authenticateToken, authorizeRole('admin', 'operator'), asyncHandler(async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const { agentId, from, to } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 5000);

    const query = {};
    if (agentId) query.agentId = agentId;
    if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(from);
        if (to) query.createdAt.$lte = new Date(to);
    }

    const commands = await Command.find(query)
        .select('-__v')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    if (format === 'csv') {
        const columns = ['commandId', 'agentId', 'command', 'status', 'priority', 'sentBy', 'createdAt', 'completedAt'];
        return sendCsv(res, commands, columns, 'commands.csv');
    }

    return sendJson(res, commands, 'commands.json');
}));

module.exports = router;
