const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const DashboardPage = require('../models/DashboardPage');

const router = express.Router();

// Helpers
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/v1/dashboard/pages -> Listar páginas del usuario autenticado
router.get('/pages', authenticateToken, async (req, res) => {
    try {
        const pages = await DashboardPage.find({ user: req.user._id }).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, data: { pages } });
    } catch (error) {
        console.error('Error listando páginas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// GET /api/v1/dashboard/pages/active -> Obtener la página activa del usuario
router.get('/pages/active', authenticateToken, async (req, res) => {
    try {
        const page = await DashboardPage.findOne({ user: req.user._id, active: true }).sort({ updatedAt: -1 });
        res.json({ success: true, data: { page } });
    } catch (error) {
        console.error('Error obteniendo página activa:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// GET /api/v1/dashboard/pages/by-slug/:slug -> Obtener página por slug
router.get('/pages/by-slug/:slug', authenticateToken, async (req, res) => {
    try {
        const { slug } = req.params;
        const page = await DashboardPage.findOne({ user: req.user._id, slug });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        res.json({ success: true, data: { page } });
    } catch (error) {
        console.error('Error obteniendo página por slug:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// POST /api/v1/dashboard/pages -> Crear nueva página
router.post('/pages', authenticateToken, async (req, res) => {
    try {
        const { name, slug, description, style = {}, active = false } = req.body || {};
        if (!name && !slug) return res.status(400).json({ success: false, error: 'name o slug requerido' });

        // Calcular order
        const last = await DashboardPage.findOne({ user: req.user._id }).sort({ order: -1 });
        const order = last ? (last.order + 1) : 0;

        const page = new DashboardPage({
            user: req.user._id,
            name: name || slug,
            slug: slug,
            description,
            style,
            active,
            order,
            updatedBy: req.user._id
        });
        await page.save();

        // Si se marca activa, desactivar otras
        if (page.active) {
            await DashboardPage.updateMany({ user: req.user._id, _id: { $ne: page._id } }, { $set: { active: false } });
        }

        res.status(201).json({ success: true, message: 'Página creada', data: { page } });
    } catch (error) {
        console.error('Error creando página:', error);
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'Slug ya existe para este usuario' });
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// GET /api/v1/dashboard/pages/:id -> Obtener detalle de una página
router.get('/pages/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        res.json({ success: true, data: { page } });
    } catch (error) {
        console.error('Error obteniendo página:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// PATCH /api/v1/dashboard/pages/:id -> Actualizar info de la página
router.patch('/pages/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

        const allowed = ['name', 'slug', 'description', 'style', 'active'];
        const updates = {};
        for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
        updates.updatedBy = req.user._id;

        const page = await DashboardPage.findOneAndUpdate(
            { _id: id, user: req.user._id },
            { $set: updates },
            { new: true, runValidators: true }
        );
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });

        if (updates.active === true) {
            await DashboardPage.updateMany({ user: req.user._id, _id: { $ne: page._id } }, { $set: { active: false } });
        }

        res.json({ success: true, message: 'Página actualizada', data: { page } });
    } catch (error) {
        console.error('Error actualizando página:', error);
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'Slug ya existe para este usuario' });
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// DELETE /api/v1/dashboard/pages/:id -> Eliminar página
router.delete('/pages/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const deleted = await DashboardPage.findOneAndDelete({ _id: id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        res.json({ success: true, message: 'Página eliminada' });
    } catch (error) {
        console.error('Error eliminando página:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// PATCH /api/v1/dashboard/pages/reorder -> Reordenar páginas [{id, order}]
router.patch('/pages/reorder', authenticateToken, async (req, res) => {
    try {
        const { items } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'items debe ser un array con {id, order}' });
        }
        const bulk = items
            .filter(it => isValidId(it.id))
            .map(it => ({ updateOne: { filter: { _id: it.id, user: req.user._id }, update: { $set: { order: it.order } } } }));
        if (bulk.length === 0) return res.status(400).json({ success: false, error: 'Sin items válidos' });
        await DashboardPage.bulkWrite(bulk);
        const pages = await DashboardPage.find({ user: req.user._id }).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, message: 'Orden actualizado', data: { pages } });
    } catch (error) {
        console.error('Error reordenando páginas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ================= Modules within a page =================

// POST /api/v1/dashboard/pages/:id/modules -> Añadir módulo
router.post('/pages/:id/modules', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const { meta, config = {}, position } = req.body || {};
        if (!meta || !meta.id || !meta.name || !meta.entry) {
            return res.status(400).json({ success: false, error: 'Meta mínima requerida: {id, name, entry}' });
        }
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        page.modules.push({ meta, config, position });
        page.updatedBy = req.user._id;
        await page.save();
        const moduleInstance = page.modules[page.modules.length - 1];
        res.status(201).json({ success: true, message: 'Módulo añadido', data: { page, module: moduleInstance } });
    } catch (error) {
        console.error('Error añadiendo módulo:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// PATCH /api/v1/dashboard/pages/:id/modules/:moduleId -> Actualizar módulo por instancia (_id)
router.patch('/pages/:id/modules/:moduleId', authenticateToken, async (req, res) => {
    try {
        const { id, moduleId } = req.params;
        if (!isValidId(id) || !isValidId(moduleId)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const { meta, config, position } = req.body || {};
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        const mod = page.modules.id(moduleId);
        if (!mod) return res.status(404).json({ success: false, error: 'Módulo no encontrado' });
        if (meta !== undefined) mod.meta = meta;
        if (config !== undefined) mod.config = config;
        if (position !== undefined) mod.position = position;
        page.updatedBy = req.user._id;
        await page.save();
        res.json({ success: true, message: 'Módulo actualizado', data: { page, module: mod } });
    } catch (error) {
        console.error('Error actualizando módulo:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// DELETE /api/v1/dashboard/pages/:id/modules/:moduleId -> Eliminar módulo por instancia
router.delete('/pages/:id/modules/:moduleId', authenticateToken, async (req, res) => {
    try {
        const { id, moduleId } = req.params;
        if (!isValidId(id) || !isValidId(moduleId)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        const mod = page.modules.id(moduleId);
        if (!mod) return res.status(404).json({ success: false, error: 'Módulo no encontrado' });
        mod.deleteOne();
        page.updatedBy = req.user._id;
        await page.save();
        res.json({ success: true, message: 'Módulo eliminado', data: { page } });
    } catch (error) {
        console.error('Error eliminando módulo:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// PATCH /api/v1/dashboard/pages/:id/modules/reorder -> Actualizar posiciones por lote
router.patch('/pages/:id/modules/reorder', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const { positions } = req.body || {};
        if (!Array.isArray(positions)) return res.status(400).json({ success: false, error: 'positions debe ser array [{moduleId, position}]' });
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        const map = new Map(positions.map(p => [String(p.moduleId), p.position]));
        page.modules.forEach(m => {
            const pos = map.get(String(m._id));
            if (pos) m.position = pos;
        });
        page.updatedBy = req.user._id;
        await page.save();
        res.json({ success: true, message: 'Posiciones actualizadas', data: { page } });
    } catch (error) {
        console.error('Error reordenando módulos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ================= Admin: gestionar páginas de otro usuario =================

// Listar páginas por userId
router.get('/admin/users/:userId/pages', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!isValidId(userId)) return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        const pages = await DashboardPage.find({ user: userId }).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, data: { pages } });
    } catch (error) {
        console.error('Error admin listando páginas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Reemplazar estilo global de una página (admin o dueño)
router.put('/pages/:id/style', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const { style = {} } = req.body || {};
        const filter = { _id: id };
        if (req.user.role !== 'admin') filter.user = req.user._id;
        const page = await DashboardPage.findOneAndUpdate(filter, { $set: { style, updatedBy: req.user._id } }, { new: true });
        if (!page) return res.status(404).json({ success: false, error: 'Página no encontrada' });
        res.json({ success: true, message: 'Estilo actualizado', data: { page } });
    } catch (error) {
        console.error('Error actualizando estilo:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
