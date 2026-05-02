const assert = require('node:assert/strict');
const test = require('node:test');

const { createLiveScoreScraper } = require('../src/services/liveScoreScraper');

function createMockFetch(responses) {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push({ url });
        const next = responses.shift();
        if (!next) throw new Error(`Unexpected fetch to ${url}`);
        const status = next.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: () => null },
            json: async () => next.body,
            text: async () => JSON.stringify(next.body),
        };
    };
    return { fetchImpl, calls };
}

const MATCH_DAY_MS = new Date('2026-04-30T19:00:00.000Z').getTime();

const sampleFotMobResponse = {
    leagues: [
        {
            name: 'LaLiga',
            matches: [
                {
                    id: '4506858',
                    home: { name: 'Real Madrid', id: 8633, score: 2 },
                    away: { name: 'Barcelona', id: 8634, score: 1 },
                    status: { ongoing: true, scoreStr: '2 - 1', liveTime: { short: "67'", long: "67' (40+27)" } },
                },
                {
                    id: '4506859',
                    home: { name: 'Atlético Madrid', id: 9906, score: 0 },
                    away: { name: 'Arsenal', id: 9825, score: 1 },
                    status: { ongoing: true, scoreStr: '0 - 1', liveTime: { short: 'HT' } },
                },
            ],
        },
    ],
};

test('findLiveScoreByTeams resolves a match by exact team names', async () => {
    const { fetchImpl } = createMockFetch([{ body: sampleFotMobResponse }]);
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    const result = await scraper.findLiveScoreByTeams({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Barcelona',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.deepEqual(result, { homeScore: 2, awayScore: 1, statusText: "67'" });
});

test('findLiveScoreByTeams hits FotMob /api/data/matches with timezone (regression: legacy /api/matches 404s)', async () => {
    const { fetchImpl, calls } = createMockFetch([{ body: sampleFotMobResponse }]);
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    await scraper.findLiveScoreByTeams({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Barcelona',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/data\/matches\?date=20260430&timezone=UTC$/);
});

test('findLiveScoreByTeams matches across name variants ("Atlético Madrid" vs "Club Atlético de Madrid")', async () => {
    const { fetchImpl } = createMockFetch([{ body: sampleFotMobResponse }]);
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    const result = await scraper.findLiveScoreByTeams({
        homeTeamName: 'Club Atlético de Madrid',
        awayTeamName: 'Arsenal FC',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.deepEqual(result, { homeScore: 0, awayScore: 1, statusText: 'HT' });
});

test('findLiveScoreByTeams returns null when no match found', async () => {
    const { fetchImpl } = createMockFetch([{ body: sampleFotMobResponse }]);
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    const result = await scraper.findLiveScoreByTeams({
        homeTeamName: 'Bayern Munich',
        awayTeamName: 'PSG',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.equal(result, null);
});

test('findLiveScoreByTeams returns null on 403 (Cloudflare-style block)', async () => {
    const { fetchImpl } = createMockFetch([{ status: 403, body: { error: 'forbidden' } }]);
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    const result = await scraper.findLiveScoreByTeams({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Barcelona',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.equal(result, null);
});

test('findLiveScoreByTeams returns null on network error', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    const result = await scraper.findLiveScoreByTeams({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Barcelona',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.equal(result, null);
});

test('findLiveScoreByTeams caches across calls within TTL', async () => {
    const { fetchImpl, calls } = createMockFetch([
        { body: sampleFotMobResponse },
        { body: sampleFotMobResponse },
    ]);
    const scraper = createLiveScoreScraper({ fetch: fetchImpl });

    await scraper.findLiveScoreByTeams({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Barcelona',
        dateUtcMs: MATCH_DAY_MS,
    });
    await scraper.findLiveScoreByTeams({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Barcelona',
        dateUtcMs: MATCH_DAY_MS,
    });
    assert.equal(calls.length, 1);
});
