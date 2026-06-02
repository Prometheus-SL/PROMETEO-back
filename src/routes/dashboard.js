const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const Agent = require('../models/Agent');
const AgentData = require('../models/AgentData');
const DashboardPage = require('../models/DashboardPage');
const DashboardVersion = require('../models/DashboardVersion');
const { asyncHandler } = require('../http/asyncHandler');
const { created, ok } = require('../http/responses');
const { createHttpError } = require('../http/errors');
const { serializeLinkedAccounts } = require('../services/linkedAccounts');
const { encryptConfigSecrets } = require('../services/moduleSecrets');

const router = express.Router();

// El front es la primera línea de validación de módulos, pero se puede saltar llamando
// al API directamente; por eso se valida también en el servidor antes de persistir.
const GRID_COLS = 4;
const GRID_ROWS = 5;
const MAX_MODULE_CONFIG_BYTES = 32 * 1024;

function assertModuleMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        throw createHttpError(400, 'MODULE_META_REQUIRED', 'Required module meta: {id, name, entry}');
    }
    for (const field of ['id', 'name', 'entry']) {
        const value = meta[field];
        if (typeof value !== 'string' || !value.trim() || value.length > 200) {
            throw createHttpError(400, 'MODULE_META_INVALID', `meta.${field} must be a non-empty string (max 200 chars)`);
        }
    }
}

function assertModuleConfig(config) {
    if (config === undefined) {
        return;
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw createHttpError(400, 'MODULE_CONFIG_INVALID', 'config must be an object');
    }
    if (JSON.stringify(config).length > MAX_MODULE_CONFIG_BYTES) {
        throw createHttpError(400, 'MODULE_CONFIG_TOO_LARGE', 'config exceeds the allowed size');
    }
}

function assertModulePosition(position) {
    if (position === undefined || position === null) {
        return;
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
        throw createHttpError(400, 'MODULE_POSITION_INVALID', 'position must be {x, y, w, h}');
    }
    const { x, y, w, h } = position;
    if (![x, y, w, h].every((value) => Number.isInteger(value))) {
        throw createHttpError(400, 'MODULE_POSITION_INVALID', 'position x/y/w/h must be integers');
    }
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > GRID_COLS || y + h > GRID_ROWS) {
        throw createHttpError(400, 'MODULE_POSITION_OUT_OF_BOUNDS', `position must fit within the ${GRID_COLS}x${GRID_ROWS} grid`);
    }
}

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
        .filter(([, account]) => (
            account?.status === 'reauth_required'
            || (account?.status === 'connected' && account?.lastError)
        ))
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
    const pages = await DashboardPage.find({ user: req.user._id, active: true })
        .select('_id name slug active principal order')
        .sort({ order: 1, createdAt: 1 })
        .lean();

    return ok(res, { pages });
}));

router.get('/pages/active', authenticateToken, asyncHandler(async (req, res) => {
    const page =
        await DashboardPage.findOne({ user: req.user._id, active: true, principal: true }).sort({ order: 1, createdAt: 1 })
        || await DashboardPage.findOne({ user: req.user._id, active: true }).sort({ order: 1, createdAt: 1 });
    return ok(res, { page });
}));

router.get('/feed', authenticateToken, asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const before = req.query.before ? new Date(req.query.before) : null;
    const linkedAccountItems = before ? [] : buildLinkedAccountFeedItems(req.user);
    const agents = await resolveSortedResults(Agent.find(buildFeedAgentScope(req)), { lastSeen: -1, createdAt: -1 });
    const agentIds = Array.isArray(agents) ? agents.map((agent) => agent.agentId).filter(Boolean) : [];
    const agentMap = new Map((Array.isArray(agents) ? agents : []).map((agent) => [agent.agentId, agent]));

    let agentItems = [];
    if (agentIds.length > 0) {
        const dataQuery = { agentId: { $in: agentIds } };
        if (before && !Number.isNaN(before.getTime())) {
            dataQuery.createdAt = { $lt: before };
        }
        const recentAgentData = await resolveSortedResults(
            AgentData.find(dataQuery),
            { createdAt: -1 },
            limit
        );

        agentItems = (Array.isArray(recentAgentData) ? recentAgentData : [])
            .map((entry) => summarizeAgentEvent(entry, agentMap.get(entry.agentId)));
    }

    const items = [...linkedAccountItems, ...agentItems].slice(0, limit);
    const lastItem = items[items.length - 1];
    const nextCursor = lastItem?.createdAt ? new Date(lastItem.createdAt).toISOString() : null;

    return ok(res, {
        items,
        nextCursor,
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
    const { name, slug, description, style = {}, active = false, principal = false } = req.body || {};
    if (!name && !slug) {
        throw createHttpError(400, 'PAGE_NAME_OR_SLUG_REQUIRED', 'name or slug is required');
    }

    const last = await DashboardPage.findOne({ user: req.user._id }).sort({ order: -1 });
    const order = last ? (last.order + 1) : 0;

    const isPrincipal = Boolean(principal);
    const page = new DashboardPage({
        user: req.user._id,
        name: name || slug,
        slug,
        description,
        style,
        active: isPrincipal ? true : active,
        principal: isPrincipal,
        order,
        updatedBy: req.user._id,
    });

    if (page.principal) {
        await DashboardPage.updateMany(
            { user: req.user._id },
            { $set: { principal: false } }
        );
    }

    await page.save();

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

router.patch('/pages/:id', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);

    const allowed = ['name', 'slug', 'description', 'style', 'active', 'principal'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            updates[key] = req.body[key];
        }
    }
    updates.updatedBy = req.user._id;

    const page = await findOwnedPage(req.params.id, req.user._id);

    if (updates.principal === true) {
        updates.active = true;
        await DashboardPage.updateMany(
            { user: req.user._id, _id: { $ne: req.params.id } },
            { $set: { principal: false } }
        );
    }
    if (updates.active === false) {
        updates.principal = false;
    }

    Object.assign(page, updates);
    if (typeof page.save === 'function') {
        await page.save();
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

router.post('/pages/:id/modules', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { meta, config = {}, position } = req.body || {};

    assertModuleMeta(meta);
    assertModuleConfig(config);
    assertModulePosition(position);

    const page = await findOwnedPage(req.params.id, req.user._id);
    page.modules.push({ meta, config: encryptConfigSecrets(meta.id, config), position });
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

    const existingConfig = moduleInstance.config;
    if (meta !== undefined) {
        assertModuleMeta(meta);
        moduleInstance.meta = meta;
    }
    if (config !== undefined) {
        assertModuleConfig(config);
        // Conserva/cifra los secretos: el placeholder reenviado por el cliente mantiene
        // el valor existente; un valor nuevo se cifra antes de guardar.
        moduleInstance.config = encryptConfigSecrets(moduleInstance.meta?.id, config, existingConfig);
    }
    if (position !== undefined) {
        assertModulePosition(position);
        moduleInstance.position = position;
    }

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

    positions.forEach((item) => assertModulePosition(item?.position));

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

/* ─── Dashboard Templates ─── */

const DASHBOARD_TEMPLATES = [
    {
        id: 'monitoring',
        name: 'System Monitoring',
        description: 'Default template for monitoring agents with CPU, memory, and disk widgets.',
        modules: [
            { meta: { id: 'system-status', name: 'System Status', entry: 'SystemStatus', category: 'monitoring' }, position: { x: 0, y: 0, w: 2, h: 2 } },
            { meta: { id: 'cpu-chart', name: 'CPU Chart', entry: 'CpuChart', category: 'monitoring' }, position: { x: 2, y: 0, w: 2, h: 1 } },
            { meta: { id: 'memory-chart', name: 'Memory Chart', entry: 'MemoryChart', category: 'monitoring' }, position: { x: 2, y: 1, w: 2, h: 1 } },
        ],
        style: { theme: 'default' },
    },
    {
        id: 'media-control',
        name: 'Media Control',
        description: 'Template focused on media playback and audio control.',
        modules: [
            { meta: { id: 'media-player', name: 'Media Player', entry: 'MediaPlayer', category: 'media' }, position: { x: 0, y: 0, w: 4, h: 2 } },
            { meta: { id: 'volume-control', name: 'Volume Control', entry: 'VolumeControl', category: 'media' }, position: { x: 0, y: 2, w: 2, h: 1 } },
        ],
        style: { theme: 'dark' },
    },
    {
        id: 'blank',
        name: 'Blank',
        description: 'Empty dashboard to build from scratch.',
        modules: [],
        style: {},
    },
];

router.get('/templates', authenticateToken, asyncHandler(async (_req, res) => {
    return ok(res, { templates: DASHBOARD_TEMPLATES });
}));

router.post('/pages/from-template', authenticateToken, asyncHandler(async (req, res) => {
    const { templateId, name, slug } = req.body || {};
    const template = DASHBOARD_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
        throw createHttpError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    }

    const last = await DashboardPage.findOne({ user: req.user._id }).sort({ order: -1 });
    const order = last ? (last.order + 1) : 0;

    const page = new DashboardPage({
        user: req.user._id,
        name: name || template.name,
        slug: slug || undefined,
        description: template.description,
        style: template.style,
        modules: template.modules,
        order,
        updatedBy: req.user._id,
    });
    await page.save();

    return created(res, { page }, { message: 'Page created from template' });
}));

/* ─── Version History ─── */

router.get('/pages/:id/versions', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await findOwnedPage(req.params.id, req.user._id);

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const versions = await DashboardVersion.find({ pageId: req.params.id })
        .sort({ version: -1 })
        .limit(limit)
        .lean();

    return ok(res, { versions });
}));

router.post('/pages/:id/versions', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const page = await findOwnedPage(req.params.id, req.user._id);

    const lastVersion = await DashboardVersion.findOne({ pageId: page._id }).sort({ version: -1 });
    const nextVersion = lastVersion ? lastVersion.version + 1 : 1;

    const version = await DashboardVersion.create({
        pageId: page._id,
        user: req.user._id,
        version: nextVersion,
        snapshot: {
            name: page.name,
            slug: page.slug,
            description: page.description,
            style: page.style,
            modules: page.modules,
        },
        changedBy: req.user._id,
    });

    return created(res, { version }, { message: 'Version saved' });
}));

router.post('/pages/:id/versions/:versionId/restore', authenticateToken, asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    assertValidId(req.params.versionId, 'Invalid version id');

    const page = await findOwnedPage(req.params.id, req.user._id);
    const version = await DashboardVersion.findOne({ _id: req.params.versionId, pageId: page._id });
    if (!version) {
        throw createHttpError(404, 'VERSION_NOT_FOUND', 'Version not found');
    }

    page.name = version.snapshot.name;
    page.slug = version.snapshot.slug;
    page.description = version.snapshot.description;
    page.style = version.snapshot.style;
    page.modules = version.snapshot.modules;
    page.updatedBy = req.user._id;
    await page.save();

    return ok(res, { page }, { message: 'Page restored from version' });
}));

module.exports = router;
