const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function makeService(overrides = {}) {
    const calls = [];
    const service = {
        listLeagues: () => [{ id: 'laliga', label: 'LaLiga', country: 'Spain' }],
        getStandings: async (leagueId) => {
            calls.push({ name: 'getStandings', leagueId });
            return { leagueId, rows: [] };
        },
        listLeagueTeams: async (leagueId) => {
            calls.push({ name: 'listLeagueTeams', leagueId });
            return [{ id: 1, name: 'Team', shortName: 'Team', code: 'TM' }];
        },
        searchTeams: async (leagueId, q) => {
            calls.push({ name: 'searchTeams', leagueId, q });
            return [];
        },
        getTeamSnapshot: async (teamId) => {
            calls.push({ name: 'getTeamSnapshot', teamId });
            return {
                state: 'finished',
                team: { id: teamId, name: 'Real Madrid', shortName: 'Real Madrid', code: 'RMA' },
                lastMatch: null,
                nextMatch: null,
                liveMatch: null,
                highlights: null,
            };
        },
        getTeamSnapshotByName: async (leagueId, name) => {
            calls.push({ name: 'getTeamSnapshotByName', leagueId, teamName: name });
            return {
                state: 'finished',
                team: { id: 86, name: 'Real Madrid CF', shortName: 'Real Madrid', code: 'RMA', crest: 'https://crests.football-data.org/86.png' },
                lastMatch: null,
                nextMatch: null,
                liveMatch: null,
                highlights: null,
            };
        },
        getFeaturedMatch: async (leagueId) => {
            calls.push({ name: 'getFeaturedMatch', leagueId });
            return { match: null, highlights: null };
        },
        resolveLeagueByTeam: async (name) => {
            calls.push({ name: 'resolveLeagueByTeam', teamName: name });
            return {
                leagueId: 'premier',
                team: { id: 65, name: 'Manchester City FC', shortName: 'Man City', code: 'MCI', crest: '' },
            };
        },
        ...overrides,
    };
    return { service, calls };
}

function buildApp(serviceOverrides = {}) {
    const { service, calls } = makeService(serviceOverrides);
    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/football.js',
        mountPath: '/api/v1/integrations/football',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken: (req, _res, next) => { req.user = { _id: 'u' }; next(); },
            },
            'src/services/footballService.js': {
                createFootballService: () => service,
            },
            'src/services/footballLeagues.js': {
                listLeagues: () => [
                    {
                        id: 'laliga',
                        label: 'LaLiga',
                        country: 'Spain',
                        supportsStandings: true,
                        highlights: { channelUrl: 'https://yt.example/laliga', channelLabel: 'LaLiga on YouTube' },
                    },
                    {
                        id: 'champions',
                        label: 'UEFA Champions League',
                        country: 'Europe',
                        supportsStandings: false,
                        highlights: { channelUrl: 'https://yt.example/uefa', channelLabel: 'UEFA on YouTube' },
                    },
                ],
                isSupportedLeague: (id) => id === 'laliga' || id === 'champions',
                getLeague: (id) => {
                    if (id === 'laliga') return { id: 'laliga', label: 'LaLiga', country: 'Spain', supportsStandings: true, highlights: { channelUrl: 'https://yt.example/laliga', channelLabel: 'LaLiga on YouTube' } };
                    if (id === 'champions') return { id: 'champions', label: 'UEFA Champions League', country: 'Europe', supportsStandings: false, highlights: { channelUrl: 'https://yt.example/uefa', channelLabel: 'UEFA on YouTube' } };
                    const err = new Error(`League "${id}" is not supported.`);
                    err.statusCode = 400;
                    err.status = 400;
                    err.code = 'FOOTBALL_LEAGUE_UNSUPPORTED';
                    throw err;
                },
                SUPPORTED_LEAGUE_IDS: ['laliga', 'champions'],
            },
        },
    });
    return { app, cleanup, calls };
}

test('GET /leagues returns the list of supported leagues', async (t) => {
    const { app, cleanup } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/leagues');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, [
        {
            id: 'laliga',
            label: 'LaLiga',
            country: 'Spain',
            supportsStandings: true,
            highlightsChannelUrl: 'https://yt.example/laliga',
            highlightsChannelLabel: 'LaLiga on YouTube',
        },
        {
            id: 'champions',
            label: 'UEFA Champions League',
            country: 'Europe',
            supportsStandings: false,
            highlightsChannelUrl: 'https://yt.example/uefa',
            highlightsChannelLabel: 'UEFA on YouTube',
        },
    ]);
});

test('GET /leagues/:leagueId/standings calls the service', async (t) => {
    const { app, cleanup, calls } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/leagues/laliga/standings');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.leagueId, 'laliga');
    assert.deepEqual(calls, [{ name: 'getStandings', leagueId: 'laliga' }]);
});

test('GET /leagues/:leagueId/standings rejects unknown leagues', async (t) => {
    const { app, cleanup } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/leagues/mystery/standings');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'FOOTBALL_LEAGUE_UNSUPPORTED');
});

test('GET /leagues/:leagueId/teams returns teams', async (t) => {
    const { app, cleanup, calls } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/leagues/laliga/teams');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.deepEqual(calls, [{ name: 'listLeagueTeams', leagueId: 'laliga' }]);
});

test('GET /leagues/:leagueId/teams/search forwards the query', async (t) => {
    const { app, cleanup, calls } = buildApp();
    t.after(cleanup);
    const res = await request(app)
        .get('/api/v1/integrations/football/leagues/laliga/teams/search')
        .query({ q: 'real' });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [{ name: 'searchTeams', leagueId: 'laliga', q: 'real' }]);
});

test('GET /leagues/:leagueId/team-snapshot resolves by name', async (t) => {
    const { app, cleanup, calls } = buildApp();
    t.after(cleanup);
    const res = await request(app)
        .get('/api/v1/integrations/football/leagues/laliga/team-snapshot')
        .query({ name: 'Real Madrid' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.state, 'finished');
    assert.deepEqual(calls, [{ name: 'getTeamSnapshotByName', leagueId: 'laliga', teamName: 'Real Madrid' }]);
});

test('GET /leagues/:leagueId/team-snapshot rejects empty name', async (t) => {
    const { app, cleanup } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/leagues/laliga/team-snapshot');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'FOOTBALL_TEAM_NAME_REQUIRED');
});

test('GET /leagues/:leagueId/featured returns the featured match', async (t) => {
    const { app, cleanup, calls } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/leagues/laliga/featured');
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [{ name: 'getFeaturedMatch', leagueId: 'laliga' }]);
});

test('GET /resolve-team resolves the team league by name', async (t) => {
    const { app, cleanup, calls } = buildApp();
    t.after(cleanup);
    const res = await request(app)
        .get('/api/v1/integrations/football/resolve-team')
        .query({ name: 'Manchester City' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.leagueId, 'premier');
    assert.equal(res.body.data.team.id, 65);
    assert.deepEqual(calls, [{ name: 'resolveLeagueByTeam', teamName: 'Manchester City' }]);
});

test('GET /resolve-team rejects an empty name', async (t) => {
    const { app, cleanup } = buildApp();
    t.after(cleanup);
    const res = await request(app).get('/api/v1/integrations/football/resolve-team');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'FOOTBALL_TEAM_NAME_REQUIRED');
});
