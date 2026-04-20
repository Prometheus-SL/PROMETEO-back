const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/dashboard/pages returns the normalized success envelope', async (t) => {
    const pages = [
        {
            _id: 'page-1',
            name: 'Main',
            slug: 'main',
            active: true,
            order: 0,
        },
    ];

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/dashboard.js',
        mountPath: '/api/v1/dashboard',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/DashboardPage.js': {
                find() {
                    return {
                        sort: async () => pages,
                    };
                },
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/dashboard/pages');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.data.pages, pages);
});

test('PATCH /api/v1/dashboard/pages/:id does not deactivate other pages when the target does not exist', async (t) => {
    let deactivateCalls = 0;

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/dashboard.js',
        mountPath: '/api/v1/dashboard',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: '507f1f77bcf86cd799439011', role: 'user' };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/DashboardPage.js': {
                findOne: async () => null,
                updateMany: async () => {
                    deactivateCalls += 1;
                },
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .patch('/api/v1/dashboard/pages/507f1f77bcf86cd799439012')
        .send({ active: true });

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'PAGE_NOT_FOUND');
    assert.equal(deactivateCalls, 0);
});

test('GET /api/v1/dashboard/pages/summary only returns active pages with principal flag', async (t) => {
    const pages = [
        { _id: 'page-1', name: 'Main', slug: 'main', active: true, principal: true, order: 1 },
    ];
    let findFilter;
    let selectFields;

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/dashboard.js',
        mountPath: '/api/v1/dashboard',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/DashboardPage.js': {
                find(filter) {
                    findFilter = filter;
                    return {
                        select(fields) {
                            selectFields = fields;
                            return {
                                sort() {
                                    return {
                                        lean: async () => pages,
                                    };
                                },
                            };
                        },
                    };
                },
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/dashboard/pages/summary');

    assert.equal(response.status, 200);
    assert.deepEqual(findFilter, { user: 'user-1', active: true });
    assert.match(selectFields, /principal/);
    assert.deepEqual(response.body.data.pages, pages);
});

test('PATCH /api/v1/dashboard/pages/:id can mark principal without hiding other active pages', async (t) => {
    let updateManyFilter;
    let updateManyUpdate;
    const page = {
        _id: '507f1f77bcf86cd799439012',
        user: '507f1f77bcf86cd799439011',
        active: false,
        principal: false,
        async save() {},
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/dashboard.js',
        mountPath: '/api/v1/dashboard',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: '507f1f77bcf86cd799439011', role: 'user' };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/DashboardPage.js': {
                findOne: async () => page,
                updateMany: async (filter, update) => {
                    updateManyFilter = filter;
                    updateManyUpdate = update;
                },
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .patch('/api/v1/dashboard/pages/507f1f77bcf86cd799439012')
        .send({ principal: true });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.page.principal, true);
    assert.equal(response.body.data.page.active, true);
    assert.deepEqual(updateManyFilter, {
        user: '507f1f77bcf86cd799439011',
        _id: { $ne: '507f1f77bcf86cd799439012' },
    });
    assert.deepEqual(updateManyUpdate, { $set: { principal: false } });
});

test('PATCH /api/v1/dashboard/pages/reorder updates page order before id route matching', async (t) => {
    let bulkWritePayload;
    const orderedPages = [
        { _id: '507f1f77bcf86cd799439014', name: 'Two', slug: 'two', order: 0 },
        { _id: '507f1f77bcf86cd799439013', name: 'One', slug: 'one', order: 1 },
    ];

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/dashboard.js',
        mountPath: '/api/v1/dashboard',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: '507f1f77bcf86cd799439011', role: 'user' };
                    next();
                },
                authorizeRole() {
                    return (_req, _res, next) => next();
                },
            },
            'src/models/DashboardPage.js': {
                bulkWrite: async (payload) => {
                    bulkWritePayload = payload;
                },
                find() {
                    return {
                        sort: async () => orderedPages,
                    };
                },
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .patch('/api/v1/dashboard/pages/reorder')
        .send({
            items: [
                { id: '507f1f77bcf86cd799439014', order: 0 },
                { id: '507f1f77bcf86cd799439013', order: 1 },
            ],
        });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.pages, orderedPages);
    assert.equal(bulkWritePayload.length, 2);
});
