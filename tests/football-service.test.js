const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

process.env.FOOTBALL_DATA_API_KEY = 'test-token';
process.env.YOUTUBE_API_KEY = ''; // disable YouTube lookups by default

function loadFixture(name) {
    const file = path.join(__dirname, 'fixtures', 'footballData', `${name}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const teamsBody = {
    teams: [
        { id: 81, name: 'FC Barcelona', shortName: 'Barça', tla: 'FCB', crest: 'https://crests.football-data.org/81.svg' },
        { id: 86, name: 'Real Madrid CF', shortName: 'Real Madrid', tla: 'RMA', crest: 'https://crests.football-data.org/86.png' },
    ],
};

function createMockFetch(responses) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        const next = responses.shift();
        if (!next) throw new Error(`Unexpected fetch to ${url}`);
        const status = next.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name) => next.headers?.[name.toLowerCase()] ?? null },
            json: async () => next.body,
            text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
        };
    };
    return { fetchImpl, calls };
}

const NOW_2026_04_28_MS = new Date('2026-04-28T20:00:00Z').getTime();

test('getStandings returns normalized rows for a supported league', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([{ body: loadFixture('standings') }]);
    const service = createFootballService({ fetch: fetchImpl });

    const standings = await service.getStandings('laliga');
    assert.equal(standings.leagueId, 'laliga');
    assert.equal(standings.rows.length, 2);
    assert.deepEqual(standings.rows[0], {
        position: 1,
        team: { id: 81, name: 'FC Barcelona', shortName: 'Barça', code: 'FCB', crest: 'https://crests.football-data.org/81.svg' },
        matches: 32, wins: 22, draws: 5, losses: 5,
        goalsFor: 70, goalsAgainst: 32, goalDiff: 38, points: 71,
        form: ['W', 'W', 'W', 'D', 'L'],
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/competitions\/PD\/standings/);
    assert.equal(calls[0].init.headers['X-Auth-Token'], 'test-token');
    assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('getStandings caches by league id within the standings TTL', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([
        { body: loadFixture('standings') },
        { body: loadFixture('standings') },
    ]);
    const service = createFootballService({ fetch: fetchImpl });
    await service.getStandings('laliga');
    await service.getStandings('laliga');
    assert.equal(calls.length, 1);
});

test('getStandings throws FOOTBALL_LEAGUE_UNSUPPORTED for unknown leagues', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([]);
    const service = createFootballService({ fetch: fetchImpl });
    await assert.rejects(
        () => service.getStandings('mystery-cup'),
        (err) => err.code === 'FOOTBALL_LEAGUE_UNSUPPORTED',
    );
});

test('getStandings maps a 5xx upstream error to FOOTBALL_PROVIDER_ERROR', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ status: 503, body: { error: 'down' } }]);
    const service = createFootballService({ fetch: fetchImpl });
    await assert.rejects(
        () => service.getStandings('laliga'),
        (err) => err.code === 'FOOTBALL_PROVIDER_ERROR',
    );
});

test('getStandings tolerates missing or malformed form strings', async () => {
    const { createFootballService } = require('../src/services/footballService');
    // First row missing form, second has compact "WWDLW", third has noise.
    const fixture = {
        standings: [
            {
                type: 'TOTAL',
                table: [
                    { position: 1, team: { id: 1, name: 'A', shortName: 'A', tla: 'A', crest: '' }, playedGames: 1, won: 1, draw: 0, lost: 0, goalsFor: 1, goalsAgainst: 0, goalDifference: 1, points: 3 },
                    { position: 2, team: { id: 2, name: 'B', shortName: 'B', tla: 'B', crest: '' }, playedGames: 5, form: 'WWDLW', won: 3, draw: 1, lost: 1, goalsFor: 5, goalsAgainst: 3, goalDifference: 2, points: 10 },
                    { position: 3, team: { id: 3, name: 'C', shortName: 'C', tla: 'C', crest: '' }, playedGames: 5, form: 'X,Y,W,L,D', won: 2, draw: 1, lost: 2, goalsFor: 4, goalsAgainst: 4, goalDifference: 0, points: 7 },
                ],
            },
        ],
    };
    const { fetchImpl } = createMockFetch([{ body: fixture }]);
    const service = createFootballService({ fetch: fetchImpl });
    const standings = await service.getStandings('laliga');
    assert.deepEqual(standings.rows[0].form, []);
    assert.deepEqual(standings.rows[1].form, ['W', 'W', 'D', 'L', 'W']);
    assert.deepEqual(standings.rows[2].form, ['W', 'L', 'D']);
});

test('callFootballData throws FOOTBALL_NOT_CONFIGURED when API key missing', async () => {
    delete process.env.FOOTBALL_DATA_API_KEY;
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([]);
    const service = createFootballService({ fetch: fetchImpl });
    await assert.rejects(
        () => service.getStandings('laliga'),
        (err) => err.code === 'FOOTBALL_NOT_CONFIGURED' && err.status === 500,
    );
    process.env.FOOTBALL_DATA_API_KEY = 'test-token';
});

test('listLeagueTeams returns normalized teams from the competition teams endpoint', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([{ body: teamsBody }]);
    const service = createFootballService({ fetch: fetchImpl });

    const teams = await service.listLeagueTeams('laliga');
    assert.equal(teams.length, 2);
    assert.deepEqual(teams[0], {
        id: 81, name: 'FC Barcelona', shortName: 'Barça', code: 'FCB', crest: 'https://crests.football-data.org/81.svg',
    });
    assert.match(calls[0].url, /\/competitions\/PD\/teams/);
});

test('listLeagueTeams caches results across calls', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([
        { body: { teams: [] } },
        { body: { teams: [] } },
    ]);
    const service = createFootballService({ fetch: fetchImpl });
    await service.listLeagueTeams('laliga');
    await service.listLeagueTeams('laliga');
    assert.equal(calls.length, 1);
});

test('getStandings returns empty rows for a league that does not support standings (champions)', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([]); // no upstream call expected
    const service = createFootballService({ fetch: fetchImpl });

    const standings = await service.getStandings('champions');
    assert.deepEqual(standings, { leagueId: 'champions', rows: [] });
    assert.equal(calls.length, 0);
});

test('searchTeams filters case-insensitively', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsBody }]);
    const service = createFootballService({ fetch: fetchImpl });
    const result = await service.searchTeams('laliga', 'real');
    const names = result.map((t) => t.name);
    assert.deepEqual(names, ['Real Madrid CF']);
});

test('searchTeams returns the full list for empty query', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsBody }]);
    const service = createFootballService({ fetch: fetchImpl });
    const result = await service.searchTeams('laliga', '');
    assert.equal(result.length, 2);
});

test('getTeamSnapshot returns finished state with last match', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([{ body: loadFixture('competition-matches') }]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.equal(snapshot.state, 'upcoming'); // next match is 2026-04-29 (within 24h of 2026-04-28)
    assert.equal(snapshot.lastMatch.id, 489050);
    assert.equal(snapshot.lastMatch.home.score, 2);
    assert.equal(snapshot.lastMatch.away.score, 1);
    assert.equal(snapshot.nextMatch.id, 489051);
    assert.equal(snapshot.liveMatch, null);
    assert.equal(snapshot.team.id, 86);
    assert.match(calls[0].url, /\/competitions\/PD\/matches/);
    assert.match(calls[0].url, /dateFrom=/);
    assert.match(calls[0].url, /dateTo=/);
});

test('getTeamSnapshot returns live state when a match is in progress', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: loadFixture('competition-matches-live') }]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.equal(snapshot.state, 'live');
    assert.equal(snapshot.liveMatch.id, 489051);
    assert.equal(snapshot.liveMatch.away.score, 1);
});

test('getTeamSnapshot returns finished when next match is more than 24h away', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: loadFixture('competition-matches') }]);
    // Pretend "now" is 3 days before the upcoming match.
    const earlier = new Date('2026-04-25T12:00:00Z').getTime();
    const service = createFootballService({ fetch: fetchImpl, now: () => earlier });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.equal(snapshot.state, 'finished');
});

test('getTeamSnapshot tolerates a team with no matches in the window', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: { matches: [] } }]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 99999);
    assert.equal(snapshot.state, 'finished');
    assert.equal(snapshot.lastMatch, null);
    assert.equal(snapshot.nextMatch, null);
    assert.equal(snapshot.liveMatch, null);
});

test('getTeamSnapshot reuses the cached competition matches window', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([{ body: loadFixture('competition-matches') }]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });
    await service.getTeamSnapshot('laliga', 86);
    await service.getTeamSnapshot('laliga', 78);
    // Two team snapshots, but only one upstream call (cached competition window).
    assert.equal(calls.length, 1);
});

test('getTeamSnapshotByName resolves a team by name', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([
        { body: teamsBody },
        { body: loadFixture('competition-matches') },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });
    const snapshot = await service.getTeamSnapshotByName('laliga', 'Real Madrid');
    assert.equal(snapshot.team.id, 86);
    assert.equal(snapshot.lastMatch.id, 489050);
});

test('getTeamSnapshotByName matches case-insensitively', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([
        { body: teamsBody },
        { body: loadFixture('competition-matches') },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });
    const snapshot = await service.getTeamSnapshotByName('laliga', 'real madrid');
    assert.equal(snapshot.team.id, 86);
});

test('getTeamSnapshotByName throws FOOTBALL_TEAM_NOT_FOUND', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsBody }]);
    const service = createFootballService({ fetch: fetchImpl });
    await assert.rejects(
        () => service.getTeamSnapshotByName('laliga', 'Manchester City'),
        (err) => err.code === 'FOOTBALL_TEAM_NOT_FOUND' && err.status === 404,
    );
});

test('getTeamSnapshotByName throws FOOTBALL_TEAM_NAME_REQUIRED for empty name', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([]);
    const service = createFootballService({ fetch: fetchImpl });
    await assert.rejects(
        () => service.getTeamSnapshotByName('laliga', ''),
        (err) => err.code === 'FOOTBALL_TEAM_NAME_REQUIRED' && err.status === 400,
    );
});

test('getFeaturedMatch returns the most recent finished match', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: loadFixture('competition-matches') }]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });
    const featured = await service.getFeaturedMatch('laliga');
    // Two finished matches; most recent is on 2026-04-22 (match 489052) > 489050 on 2026-04-21.
    assert.equal(featured.match.id, 489052);
    assert.equal(featured.highlights, null);
});

test('getFeaturedMatch returns the live match when one is in progress', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: loadFixture('competition-matches-live') }]);
    const service = createFootballService({ fetch: fetchImpl });
    const featured = await service.getFeaturedMatch('laliga');
    assert.equal(featured.match.status, 'inprogress');
});

test('getFeaturedMatch returns null when window is empty', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: { matches: [] } }]);
    const service = createFootballService({ fetch: fetchImpl });
    const featured = await service.getFeaturedMatch('laliga');
    assert.equal(featured.match, null);
});

test('normalizeMatch preserves null scores for unplayed matches', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: loadFixture('competition-matches') }]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.notEqual(snapshot.nextMatch, null);
    assert.equal(snapshot.nextMatch.home.score, null);
    assert.equal(snapshot.nextMatch.away.score, null);
});

test('getTeamSnapshot populates highlights when YOUTUBE_API_KEY is set and search returns a video', async () => {
    process.env.YOUTUBE_API_KEY = 'youtube-test-key';
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([
        { body: loadFixture('competition-matches') },
        { body: { items: [{ id: { videoId: 'abc123XYZ' } }] } },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.deepEqual(snapshot.highlights, { videoId: 'abc123XYZ' });
    // Two upstream calls: matches window + YouTube search.
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /googleapis\.com\/youtube\/v3\/search/);
    assert.match(calls[1].url, /videoEmbeddable=true/);
    assert.match(calls[1].url, /key=youtube-test-key/);
    process.env.YOUTUBE_API_KEY = '';
});

test('getTeamSnapshot returns null highlights when YOUTUBE_API_KEY is missing', async () => {
    process.env.YOUTUBE_API_KEY = '';
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl, calls } = createMockFetch([
        { body: loadFixture('competition-matches') },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.equal(snapshot.highlights, null);
    assert.equal(calls.length, 1); // no YouTube call
});

test('getTeamSnapshot returns null highlights when YouTube search returns no items', async () => {
    process.env.YOUTUBE_API_KEY = 'youtube-test-key';
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([
        { body: loadFixture('competition-matches') },
        { body: { items: [] } },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });

    const snapshot = await service.getTeamSnapshot('laliga', 86);
    assert.equal(snapshot.highlights, null);
    process.env.YOUTUBE_API_KEY = '';
});

test('getFeaturedMatch populates highlights when YouTube key is set', async () => {
    process.env.YOUTUBE_API_KEY = 'youtube-test-key';
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([
        { body: loadFixture('competition-matches') },
        { body: { items: [{ id: { videoId: 'feat999' } }] } },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });
    const featured = await service.getFeaturedMatch('laliga');
    assert.deepEqual(featured.highlights, { videoId: 'feat999' });
    process.env.YOUTUBE_API_KEY = '';
});

const teamsWithAtleti = {
    teams: [
        { id: 81, name: 'FC Barcelona', shortName: 'Barça', tla: 'FCB', crest: '' },
        { id: 86, name: 'Real Madrid CF', shortName: 'Real Madrid', tla: 'RMA', crest: '' },
        { id: 78, name: 'Club Atlético de Madrid', shortName: 'Atlético', tla: 'ATL', crest: '' },
        { id: 90, name: 'Real Betis Balompié', shortName: 'Real Betis', tla: 'BET', crest: '' },
    ],
};

test('searchTeams matches across accents (atletico finds Atlético)', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsWithAtleti }]);
    const service = createFootballService({ fetch: fetchImpl });
    const result = await service.searchTeams('laliga', 'atletico');
    const names = result.map((t) => t.name);
    assert.deepEqual(names, ['Club Atlético de Madrid']);
});

test('searchTeams matches across casing and partial accents (Atléti)', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsWithAtleti }]);
    const service = createFootballService({ fetch: fetchImpl });
    const result = await service.searchTeams('laliga', 'AtlÉti');
    const names = result.map((t) => t.name);
    assert.deepEqual(names, ['Club Atlético de Madrid']);
});

test('searchTeams expands the "atleti" nickname to Atlético de Madrid', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsWithAtleti }]);
    const service = createFootballService({ fetch: fetchImpl });
    const result = await service.searchTeams('laliga', 'Atleti');
    const names = result.map((t) => t.name);
    assert.deepEqual(names, ['Club Atlético de Madrid']);
});

test('searchTeams expands "barca" to Barcelona', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([{ body: teamsWithAtleti }]);
    const service = createFootballService({ fetch: fetchImpl });
    const result = await service.searchTeams('laliga', 'Barca');
    const names = result.map((t) => t.name);
    assert.deepEqual(names, ['FC Barcelona']);
});

test('getTeamSnapshotByName resolves "Atleti" to Club Atlético de Madrid', async () => {
    const { createFootballService } = require('../src/services/footballService');
    const { fetchImpl } = createMockFetch([
        { body: teamsWithAtleti },
        { body: loadFixture('competition-matches') },
    ]);
    const service = createFootballService({ fetch: fetchImpl, now: () => NOW_2026_04_28_MS });
    const snapshot = await service.getTeamSnapshotByName('laliga', 'Atleti');
    assert.equal(snapshot.team.id, 78);
});
