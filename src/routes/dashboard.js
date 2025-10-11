const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const UserDashboard = require('../models/UserDashboard');

const router = express.Router();

// Util: obtener o crear dashboard vacío para userId
async function getOrCreateDashboard(userId, updaterId) {
    let doc = await UserDashboard.findOne({ user: userId });
    if (!doc) {
        doc = new UserDashboard({ user: userId, modules: [], updatedBy: updaterId });
        await doc.save();
    }
    return doc;
}

// GET /api/v1/dashboard/me -> devuelve mi dashboard
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const dash = await getOrCreateDashboard(req.user._id, req.user._id);
        res.json({ success: true, data: { dashboard: dash } });
    } catch (error) {
        console.error('Error obteniendo dashboard:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// PUT /api/v1/dashboard/me -> reemplaza módulos/config completos
router.put('/me', authenticateToken, async (req, res) => {
    try {
        const { modules = [], layout } = req.body || {};

        const updated = await UserDashboard.findOneAndUpdate(
            { user: req.user._id },
            { $set: { modules, layout, updatedBy: req.user._id } },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ success: true, message: 'Dashboard actualizado', data: { dashboard: updated } });
    } catch (error) {
        console.error('Error actualizando dashboard:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// PATCH /api/v1/dashboard/me/modules/:moduleId -> actualiza config/position de un módulo específico por su meta.id
router.patch('/me/modules/:moduleId', authenticateToken, async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { config, position, meta } = req.body || {};

        const dash = await getOrCreateDashboard(req.user._id, req.user._id);
        const idx = dash.modules.findIndex(m => m.meta && m.meta.id === moduleId);

        if (idx === -1) {
            if (!meta || !meta.id || !meta.name || !meta.entry) {
                return res.status(400).json({ success: false, error: 'Meta mínima requerida para nuevo módulo (id, name, entry)' });
            }
            dash.modules.push({ meta, config: config || {}, position });
        } else {
            if (config !== undefined) dash.modules[idx].config = config;
            if (position !== undefined) dash.modules[idx].position = position;
            if (meta !== undefined) dash.modules[idx].meta = meta; // opcionalmente permitir actualizar meta
        }

        dash.updatedBy = req.user._id;
        await dash.save();

        res.json({ success: true, message: 'Módulo actualizado', data: { dashboard: dash } });
    } catch (error) {
        console.error('Error actualizando módulo:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Admin: GET de dashboard por userId
router.get('/user/:userId', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        const dash = await getOrCreateDashboard(userId, req.user._id);
        res.json({ success: true, data: { dashboard: dash } });
    } catch (error) {
        console.error('Error obteniendo dashboard de usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Admin: PUT de dashboard por userId
router.put('/user/:userId', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        const { modules = [], layout } = req.body || {};

        const updated = await UserDashboard.findOneAndUpdate(
            { user: userId },
            { $set: { modules, layout, updatedBy: req.user._id } },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ success: true, message: 'Dashboard de usuario actualizado', data: { dashboard: updated } });
    } catch (error) {
        console.error('Error actualizando dashboard de usuario:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
