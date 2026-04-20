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
