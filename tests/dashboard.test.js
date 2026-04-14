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
