const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { listLeagues, getLeague } = require('../services/footballLeagues');
const { createFootballService } = require('../services/footballService');

const service = createFootballService();
const router = express.Router();

router.get(
    '/leagues',
    authenticateToken,
    asyncHandler(async (_req, res) => {
        const leagues = listLeagues().map((l) => ({
            id: l.id,
            label: l.label,
            country: l.country,
            highlightsChannelUrl: l.highlights?.channelUrl ?? null,
            highlightsChannelLabel: l.highlights?.channelLabel ?? null,
        }));
        return ok(res, leagues);
    }),
);

router.get(
    '/leagues/:leagueId/standings',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const leagueId = String(req.params.leagueId || '').trim();
        getLeague(leagueId); // throws FOOTBALL_LEAGUE_UNSUPPORTED if unknown
        const data = await service.getStandings(leagueId);
        return ok(res, data);
    }),
);

router.get(
    '/leagues/:leagueId/teams',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const leagueId = String(req.params.leagueId || '').trim();
        getLeague(leagueId);
        const data = await service.listLeagueTeams(leagueId);
        return ok(res, data);
    }),
);

router.get(
    '/leagues/:leagueId/teams/search',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const leagueId = String(req.params.leagueId || '').trim();
        getLeague(leagueId);
        const q = String(req.query.q || '').trim();
        const data = await service.searchTeams(leagueId, q);
        return ok(res, data);
    }),
);

router.get(
    '/leagues/:leagueId/featured',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const leagueId = String(req.params.leagueId || '').trim();
        getLeague(leagueId);
        const data = await service.getFeaturedMatch(leagueId);
        return ok(res, data);
    }),
);

router.get(
    '/leagues/:leagueId/team-snapshot',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const leagueId = String(req.params.leagueId || '').trim();
        getLeague(leagueId);
        const name = String(req.query.name || '').trim();
        if (!name) {
            throw createHttpError(400, 'FOOTBALL_TEAM_NAME_REQUIRED', 'A team name is required.');
        }
        const data = await service.getTeamSnapshotByName(leagueId, name);
        return ok(res, data);
    }),
);

module.exports = router;
