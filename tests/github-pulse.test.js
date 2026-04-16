const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

test('GET /api/v1/github/pulse returns the user pulse summary', async (t) => {
    const pulse = {
        profile: {
            login: 'mike',
            displayName: 'Mike',
        },
        assignedPullRequests: [
            {
                id: 101,
                number: 101,
                repository: 'prometeo/front',
                title: 'Improve account page',
                hasFailingChecks: true,
            },
        ],
        notifications: [
            {
                id: 'thread-1',
                reason: 'mention',
                repository: 'prometeo/front',
                title: 'Need your review',
                unread: true,
            },
        ],
        mentionsCount: 1,
        failingChecksCount: 1,
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/github.js',
        mountPath: '/api/v1/github',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1', role: 'user' };
                    next();
                },
            },
            'src/services/githubIntegration.js': {
                getGithubPulse: async () => pulse,
            },
        },
    });
    t.after(cleanup);

    const response = await request(app).get('/api/v1/github/pulse');

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.profile.login, 'mike');
    assert.equal(response.body.data.assignedPullRequests[0].hasFailingChecks, true);
    assert.equal(response.body.data.mentionsCount, 1);
});
