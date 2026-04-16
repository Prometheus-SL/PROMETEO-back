const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/google/summary returns the aggregated workspace summary', async (t) => {
    const summary = {
        provider: {
            status: 'connected',
            connectedAt: '2026-04-15T08:00:00.000Z',
        },
        calendar: {
            busyNow: true,
            nextStartAt: '2026-04-16T09:00:00.000Z',
            items: [
                {
                    id: 'event-1',
                    title: 'Daily Standup',
                },
            ],
        },
        tasks: {
            dueTodayCount: 2,
            items: [
                {
                    id: 'task-1',
                    title: 'Ship Google bundle',
                    taskListId: 'primary',
                    status: 'needsAction',
                },
            ],
        },
        inbox: {
            unreadCount: 5,
            items: [
                {
                    id: 'message-1',
                    subject: 'Review requested',
                },
            ],
        },
        focus: {
            active: true,
            reason: 'calendar',
        },
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/google.js',
        mountPath: '/api/v1/google',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
            },
            'src/services/googleIntegration.js': {
                getGoogleWorkspaceSummary: async () => summary,
                completeGoogleTask: async () => null,
                rescheduleGoogleTask: async () => null,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/google/summary');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.calendar.busyNow, true);
    assert.equal(response.body.data.tasks.items[0].id, 'task-1');
    assert.equal(response.body.data.inbox.unreadCount, 5);
});

test('POST /api/v1/google/tasks/:taskListId/:taskId/complete marks the task as completed', async (t) => {
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/google.js',
        mountPath: '/api/v1/google',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
            },
            'src/services/googleIntegration.js': {
                getGoogleWorkspaceSummary: async () => null,
                completeGoogleTask: async () => ({
                    id: 'task-1',
                    taskListId: 'primary',
                    status: 'completed',
                }),
                rescheduleGoogleTask: async () => null,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).post('/api/v1/google/tasks/primary/task-1/complete');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.task.status, 'completed');
});

test('POST /api/v1/google/tasks/:taskListId/:taskId/reschedule updates the due date', async (t) => {
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/google.js',
        mountPath: '/api/v1/google',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
            },
            'src/services/googleIntegration.js': {
                getGoogleWorkspaceSummary: async () => null,
                completeGoogleTask: async () => null,
                rescheduleGoogleTask: async (_user, taskListId, taskId, due) => ({
                    id: taskId,
                    taskListId,
                    due,
                    status: 'needsAction',
                }),
            },
        },
    });
    t.after(cleanup);

    const response = await request(app)
        .post('/api/v1/google/tasks/primary/task-1/reschedule')
        .send({ due: '2026-04-17T09:00:00.000Z' });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.task.due, '2026-04-17T09:00:00.000Z');
});
