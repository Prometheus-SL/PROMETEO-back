const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const DashboardPage = require('../models/DashboardPage');

const router = express.Router();

// Helpers
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/v1/dashboard/pages -> List pages for the authenticated user
router.get('/pages', authenticateToken, async (req, res) => {
    try {
        const pages = await DashboardPage.find({ user: req.user._id }).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, data: { pages } });
    } catch (error) {
        console.error('Error listing pages:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/v1/dashboard/pages/summary -> List lightweight page metadata
router.get('/pages/summary', authenticateToken, async (req, res) => {
    try {
        const pages = await DashboardPage.find({ user: req.user._id })
            .select('_id name slug active order')
            .sort({ order: 1, createdAt: 1 })
            .lean();
        res.json({ success: true, data: { pages } });
    } catch (error) {
        console.error('Error listing page summaries:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/v1/dashboard/pages/active -> Get the active page for the user
router.get('/pages/active', authenticateToken, async (req, res) => {
    try {
        const page = await DashboardPage.findOne({ user: req.user._id, active: true }).sort({ updatedAt: -1 });
        res.json({ success: true, data: { page } });
    } catch (error) {
        console.error('Error fetching active page:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/v1/dashboard/pages/by-slug/:slug -> Get a page by slug
router.get('/pages/by-slug/:slug', authenticateToken, async (req, res) => {
    try {
        const { slug } = req.params;
        const page = await DashboardPage.findOne({ user: req.user._id, slug });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });
        res.json({ success: true, data: { page } });
    } catch (error) {
        console.error('Error fetching page by slug:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/v1/dashboard/pages -> Create a new page
router.post('/pages', authenticateToken, async (req, res) => {
    try {
        const { name, slug, description, style = {}, active = false } = req.body || {};
        if (!name && !slug) {
            return res.status(400).json({ success: false, error: 'name or slug is required' });
        }

        const last = await DashboardPage.findOne({ user: req.user._id }).sort({ order: -1 });
        const order = last ? (last.order + 1) : 0;

        const page = new DashboardPage({
            user: req.user._id,
            name: name || slug,
            slug,
            description,
            style,
            active,
            order,
            updatedBy: req.user._id,
        });
        await page.save();

        if (page.active) {
            await DashboardPage.updateMany(
                { user: req.user._id, _id: { $ne: page._id } },
                { $set: { active: false } }
            );
        }

        res.status(201).json({ success: true, message: 'Page created', data: { page } });
    } catch (error) {
        console.error('Error creating page:', error);
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'Slug already exists for this user' });
        }
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map((e) => e.message);
            return res.status(400).json({ success: false, error: 'Validation error', details });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/v1/dashboard/pages/:id -> Get a page by id
router.get('/pages/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });
        res.json({ success: true, data: { page } });
    } catch (error) {
        console.error('Error fetching page:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/v1/dashboard/pages/:id -> Update page metadata
router.patch('/pages/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

        const allowed = ['name', 'slug', 'description', 'style', 'active'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        updates.updatedBy = req.user._id;

        const page = await DashboardPage.findOneAndUpdate(
            { _id: id, user: req.user._id },
            { $set: updates },
            { new: true, runValidators: true }
        );
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

        if (updates.active === true) {
            await DashboardPage.updateMany(
                { user: req.user._id, _id: { $ne: page._id } },
                { $set: { active: false } }
            );
        }

        res.json({ success: true, message: 'Page updated', data: { page } });
    } catch (error) {
        console.error('Error updating page:', error);
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'Slug already exists for this user' });
        }
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map((e) => e.message);
            return res.status(400).json({ success: false, error: 'Validation error', details });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/v1/dashboard/pages/:id -> Delete a page
router.delete('/pages/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const deleted = await DashboardPage.findOneAndDelete({ _id: id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, error: 'Page not found' });
        res.json({ success: true, message: 'Page deleted' });
    } catch (error) {
        console.error('Error deleting page:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/v1/dashboard/pages/reorder -> Reorder pages [{id, order}]
router.patch('/pages/reorder', authenticateToken, async (req, res) => {
    try {
        const { items } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'items must be an array with {id, order}' });
        }

        const bulk = items
            .filter((item) => isValidId(item.id))
            .map((item) => ({
                updateOne: {
                    filter: { _id: item.id, user: req.user._id },
                    update: { $set: { order: item.order } },
                },
            }));

        if (bulk.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid items provided' });
        }

        await DashboardPage.bulkWrite(bulk);
        const pages = await DashboardPage.find({ user: req.user._id }).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, message: 'Order updated', data: { pages } });
    } catch (error) {
        console.error('Error reordering pages:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ================= Modules within a page =================

// POST /api/v1/dashboard/pages/:id/modules -> Add a module
router.post('/pages/:id/modules', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const { meta, config = {}, position } = req.body || {};
        if (!meta || !meta.id || !meta.name || !meta.entry) {
            return res.status(400).json({ success: false, error: 'Required module meta: {id, name, entry}' });
        }

        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

        page.modules.push({ meta, config, position });
        page.updatedBy = req.user._id;
        await page.save();

        const moduleInstance = page.modules[page.modules.length - 1];
        res.status(201).json({ success: true, message: 'Module added', data: { page, module: moduleInstance } });
    } catch (error) {
        console.error('Error adding module:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map((e) => e.message);
            return res.status(400).json({ success: false, error: 'Validation error', details });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/v1/dashboard/pages/:id/modules/:moduleId -> Update a module instance
router.patch('/pages/:id/modules/:moduleId', authenticateToken, async (req, res) => {
    try {
        const { id, moduleId } = req.params;
        if (!isValidId(id) || !isValidId(moduleId)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }

        const { meta, config, position } = req.body || {};
        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

        const mod = page.modules.id(moduleId);
        if (!mod) return res.status(404).json({ success: false, error: 'Module not found' });

        if (meta !== undefined) mod.meta = meta;
        if (config !== undefined) mod.config = config;
        if (position !== undefined) mod.position = position;

        page.updatedBy = req.user._id;
        await page.save();
        res.json({ success: true, message: 'Module updated', data: { page, module: mod } });
    } catch (error) {
        console.error('Error updating module:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map((e) => e.message);
            return res.status(400).json({ success: false, error: 'Validation error', details });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/v1/dashboard/pages/:id/modules/:moduleId -> Delete a module instance
router.delete('/pages/:id/modules/:moduleId', authenticateToken, async (req, res) => {
    try {
        const { id, moduleId } = req.params;
        if (!isValidId(id) || !isValidId(moduleId)) {
            return res.status(400).json({ success: false, error: 'Invalid id' });
        }

        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

        const mod = page.modules.id(moduleId);
        if (!mod) return res.status(404).json({ success: false, error: 'Module not found' });

        mod.deleteOne();
        page.updatedBy = req.user._id;
        await page.save();
        res.json({ success: true, message: 'Module deleted', data: { page } });
    } catch (error) {
        console.error('Error deleting module:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/v1/dashboard/pages/:id/modules/reorder -> Update module positions in bulk
router.patch('/pages/:id/modules/reorder', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

        const { positions } = req.body || {};
        if (!Array.isArray(positions)) {
            return res.status(400).json({ success: false, error: 'positions must be an array [{moduleId, position}]' });
        }

        const page = await DashboardPage.findOne({ _id: id, user: req.user._id });
        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

        const map = new Map(positions.map((position) => [String(position.moduleId), position.position]));
        page.modules.forEach((module) => {
            const nextPosition = map.get(String(module._id));
            if (nextPosition) module.position = nextPosition;
        });

        page.updatedBy = req.user._id;
        await page.save();
        res.json({ success: true, message: 'Positions updated', data: { page } });
    } catch (error) {
        console.error('Error reordering modules:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ================= Admin: manage pages for another user =================

// List pages by user id
router.get('/admin/users/:userId/pages', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!isValidId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }

        const pages = await DashboardPage.find({ user: userId }).sort({ order: 1, createdAt: 1 });
        res.json({ success: true, data: { pages } });
    } catch (error) {
        console.error('Error listing admin pages:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Replace the global page style (admin or owner)
router.put('/pages/:id/style', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

        const { style = {} } = req.body || {};
        const filter = { _id: id };
        if (req.user.role !== 'admin') filter.user = req.user._id;

        const page = await DashboardPage.findOneAndUpdate(
            filter,
            { $set: { style, updatedBy: req.user._id } },
            { new: true }
        );

        if (!page) return res.status(404).json({ success: false, error: 'Page not found' });
        res.json({ success: true, message: 'Style updated', data: { page } });
    } catch (error) {
        console.error('Error updating style:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
