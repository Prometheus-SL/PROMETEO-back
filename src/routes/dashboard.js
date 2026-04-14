const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const Agent = require('../models/Agent');
const AgentData = require('../models/AgentData');
const DashboardPage = require('../models/DashboardPage');
const { asyncHandler } = require('../http/asyncHandler');
const { created, ok } = require('../http/responses');
const { createHttpError } = require('../http/errors');
const { serializeLinkedAccounts } = require('../services/linkedAccounts');

const router = express.Router();

function sortDateLikeDesc(items, fields) {
    return [...items].sort((left, right) => {
        for (const field of fields) {
            const leftValue = left?.[field] ? new Date(left[field]).getTime() : 0;
            const rightValue = right?.[field] ? new Date(right[field]).getTime() : 0;
            if (leftValue !== rightValue) {
                return rightValue - leftValue;
            }
        }

        return 0;
    });
}

async function resolveSortedResults(queryLike, sortSpec, limit) {
    if (queryLike && typeof queryLike.sort === 'function' && !Array.isArray(queryLike)) {
        const sortedQuery = queryLike.sort(sortSpec);
        if (typeof limit === 'number' && typeof sortedQuery?.limit === 'function') {
            return sortedQuery.limit(limit);
        }

        return sortedQuery;
    }

    const resolved = await queryLike;
    if (!Array.isArray(resolved)) {
        return resolved;
    }

    const ordered = sortDateLikeDesc(resolved, Object.keys(sortSpec || {}));
    return typeof limit === 'number' ? ordered.slice(0, limit) : ordered;
}

function buildFeedAgentScope(req) {
    if (req.user.role === 'admin' || req.user.role === 'operator') {
        return {};
    }

    return { user: req.user._id };
}

function buildLinkedAccountFeedItems(user) {
    const linkedAccounts = serializeLinkedAccounts(user.linkedAccounts);

    return Object.entries(linkedAccounts)
        .filter(([, account]) => account?.status && account.status !== 'connected')
        .map(([provider, account]) => ({
            id: `linked-account:${provider}`,
            type: 'linked-account',
            provider,
            status: account.status,
            createdAt: account.connectedAt || null,
            title: `${provider} requires attention`,
            message: account.lastError || `Reconnect ${provider} to restore all module capabilities.`,
        }));
}

function summarizeAgentEvent(entry, agent) {
    const cpuPercent = entry?.data?.resources?.cpu?.percent;
    const hostname = entry?.data?.system?.hostname || agent?.name || entry?.agentId;
    const cpuLabel = Number.isFinite(Number(cpuPercent)) ? `CPU ${Number(cpuPercent)}%` : 'New telemetry available';

    return {
        id: `agent-data:${entry._id || `${entry.agentId}:${entry.createdAt}`}`,
        type: 'agent-data',
        agentId: entry.agentId,
        agentName: agent?.name || entry.agentId,
        dataType: entry.dataType,
        createdAt: entry.createdAt || null,
        title: `${hostname} reported ${entry.dataType}`,
        message: cpuLabel,
        payload: entry.data || {},
    };
}

function assertValidId(id, message = 'Invalid id') {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw createHttpError(400, 'INVALID_ID', message);
    }
}

async function findOwnedPage(pageId, userId) {
    const page = await DashboardPage.findOne({ _id: pageId, user: userId });
    if (!page) {
        throw createHttpError(404, 'PAGE_NOT_FOUND', 'Page not found');
    }

    return page;
}

router.get('/pages', authenticateToken, asyncHandler(async (req, res) => {
    const pages = await DashboardPage.find({ user: req.user._id }).sort({ order: 1, createdAt: 1 });
    return ok(res, { pages });
}));

router.get('/pages/summary', authenticateToken, asyncHandler(async (req, res) => {
    const pages = await DashboardPage.find({ user: req.user._id })
        .select('_id name slug active order')
        .sort({ order: 1, createdAt: 1 })
        .lean();

    return ok(res, { pages });
}));

router.get('/pages/active', authenticateToken, asyncHandler(async (req, res) => {
    const page = await DashboardPage.findOne({ user: req.user._id, active: true }).sort({ updatedAt: -1 });
    return ok(res, { page });
}));

router.get('/feed', authenticateToken, asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const linkedAccountItems = buildLinkedAccountFeedItems(req.user);
    const agents = await resolveSortedResults(Agent.find(buildFeedAgentScope(req)), { lastSeen: -1, createdAt: -1 });
    const agentIds = Array.isArray(agents) ? agents.map((agent) => agent.agentId).filter(Boolean) : [];
    const agentMap = new Map((Array.isArray(agents) ? agents : []).map((agent) => [agent.agentId, agent]));

    let agentItems = [];
    if (agentIds.length > 0) {
        const recentAgentData = await resolveSortedResults(
            AgentData.find({ agentId: { $in: agentIds } }),
            { createdAt: -1 },
            limit
        );

        agentItems = (Array.isArray(recentAgentData) ? recentAgentData : [])
            .map((entry) => summarizeAgentEvent(entry, agentMap.get(entry.agentId)));
    }

    const items = [...linkedAccountItems, ...agentItems].slice(0, limit);

    return ok(res, {
        items,
        summary: {
            total: items.length,
            linkedAccounts: linkedAccountItems.length,
            agentEvents: agentItems.length,
        },
    });
}));

router.get('/pages/by-slug/:slug', authenticateToken, asyncHandler(async (req, res) => {
    const page = await DashboardPage.findOne({ user: req.user._id, slug: req.params.slug });
    if (!page) {
        throw createHttpError(404, 'PAGE_NOT_FOUND', 'Page not found');
    }

    return ok(res, { page });
}));

router.post('/pages', authenticateToken, asyncHandler(async (req, res) => {
    const { name, slug, description, style = {}, active = false } = req.body || {};
    if (!name && !slug) {
        throw createHttpError(400, 'PAGE_NAME_OR_SLUG_REQUIRED', 'name or slug is required');
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

    return created(res, { page }, { message: 'Page created' });
}));

router.get('/pages/:id', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const page = await DashboardPage.findOne({ _id: req.params.id, user: req.user._id });
    if (!page) {
        throw createHttpError(404, 'PAGE_NOT_FOUND', 'Page not found');
    }

    return ok(res, { page });
}));

router.patch('/pages/:id', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    const allowed = ['name', 'slug', 'description', 'style', 'active'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            updates[key] = req.body[key];
        }
    }
    updates.updatedBy = req.user._id;

    const page = await DashboardPage.findOneAndUpdate(
        { _id: req.params.id, user: req.user._id },
        { $set: updates },
        { new: true, runValidators: true }
    );
    if (!page) {
        throw createHttpError(404, 'PAGE_NOT_FOUND', 'Page not found');
    }

    if (updates.active === true) {
        await DashboardPage.updateMany(
            { user: req.user._id, _id: { $ne: page._id } },
            { $set: { active: false } }
        );
    }

    return ok(res, { page }, { message: 'Page updated' });
}));

router.delete('/pages/:id', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    const deleted = await DashboardPage.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!deleted) {
        throw createHttpError(404, 'PAGE_NOT_FOUND', 'Page not found');
    }

    return ok(res, null, { message: 'Page deleted' });
}));

router.patch('/pages/reorder', authenticateToken, asyncHandler(async (req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        throw createHttpError(400, 'PAGE_REORDER_ITEMS_REQUIRED', 'items must be an array with {id, order}');
    }

    const bulk = items
        .filter((item) => mongoose.Types.ObjectId.isValid(item.id))
        .map((item) => ({
            updateOne: {
                filter: { _id: item.id, user: req.user._id },
                update: { $set: { order: item.order } },
            },
        }));

    if (bulk.length === 0) {
        throw createHttpError(400, 'PAGE_REORDER_ITEMS_INVALID', 'No valid items provided');
    }

    await DashboardPage.bulkWrite(bulk);
    const pages = await DashboardPage.find({ user: req.user._id }).sort({ order: 1, createdAt: 1 });
    return ok(res, { pages }, { message: 'Order updated' });
}));

router.post('/pages/:id/modules', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { meta, config = {}, position } = req.body || {};

    if (!meta || !meta.id || !meta.name || !meta.entry) {
        throw createHttpError(400, 'MODULE_META_REQUIRED', 'Required module meta: {id, name, entry}');
    }

    const page = await findOwnedPage(req.params.id, req.user._id);
    page.modules.push({ meta, config, position });
    page.updatedBy = req.user._id;
    await page.save();

    const moduleInstance = page.modules[page.modules.length - 1];
    return created(res, { page, module: moduleInstance }, { message: 'Module added' });
}));

router.patch('/pages/:id/modules/:moduleId', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    assertValidId(req.params.moduleId);

    const { meta, config, position } = req.body || {};
    const page = await findOwnedPage(req.params.id, req.user._id);
    const moduleInstance = page.modules.id(req.params.moduleId);

    if (!moduleInstance) {
        throw createHttpError(404, 'MODULE_NOT_FOUND', 'Module not found');
    }

    if (meta !== undefined) moduleInstance.meta = meta;
    if (config !== undefined) moduleInstance.config = config;
    if (position !== undefined) moduleInstance.position = position;

    page.updatedBy = req.user._id;
    await page.save();

    return ok(res, { page, module: moduleInstance }, { message: 'Module updated' });
}));

router.delete('/pages/:id/modules/:moduleId', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    assertValidId(req.params.moduleId);

    const page = await findOwnedPage(req.params.id, req.user._id);
    const moduleInstance = page.modules.id(req.params.moduleId);

    if (!moduleInstance) {
        throw createHttpError(404, 'MODULE_NOT_FOUND', 'Module not found');
    }

    moduleInstance.deleteOne();
    page.updatedBy = req.user._id;
    await page.save();

    return ok(res, { page }, { message: 'Module deleted' });
}));

router.patch('/pages/:id/modules/reorder', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    const { positions } = req.body || {};
    if (!Array.isArray(positions)) {
        throw createHttpError(400, 'MODULE_POSITIONS_REQUIRED', 'positions must be an array [{moduleId, position}]');
    }

    const page = await findOwnedPage(req.params.id, req.user._id);
    const positionMap = new Map(positions.map((item) => [String(item.moduleId), item.position]));

    page.modules.forEach((moduleInstance) => {
        const nextPosition = positionMap.get(String(moduleInstance._id));
        if (nextPosition !== undefined) {
            moduleInstance.position = nextPosition;
        }
    });

    page.updatedBy = req.user._id;
    await page.save();

    return ok(res, { page }, { message: 'Positions updated' });
}));

router.get('/admin/users/:userId/pages', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertValidId(req.params.userId, 'Invalid user id');
    const pages = await DashboardPage.find({ user: req.params.userId }).sort({ order: 1, createdAt: 1 });
    return ok(res, { pages });
}));

router.put('/pages/:id/style', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    const { style = {} } = req.body || {};
    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') {
        filter.user = req.user._id;
    }

    const page = await DashboardPage.findOneAndUpdate(
        filter,
        { $set: { style, updatedBy: req.user._id } },
        { new: true }
    );

    if (!page) {
        throw createHttpError(404, 'PAGE_NOT_FOUND', 'Page not found');
    }

    return ok(res, { page }, { message: 'Style updated' });
}));

module.exports = router;
