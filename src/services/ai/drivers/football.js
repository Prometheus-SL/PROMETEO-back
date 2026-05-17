const { createFootballService } = require('../../footballService');
const { isSupportedLeague } = require('../../footballLeagues');
const {
    errorResult,
    getConfig,
    getModuleId,
    moduleInstanceId,
    normalizeText,
    okResult,
    providerTargets,
    safeExecute,
    targetBase,
    targetMatches,
    unionAllowedActions,
    uniqueStrings,
} = require('../driverUtils');

const footballService = createFootballService();

const FOOTBALL_MODULE_IDS = new Set(['football-widget', 'football-widget-compact']);
const FOOTBALL_ACTIONS = new Set([
    'football.team.summary',
    'football.featured.summary',
    'football.standings',
]);

function normalizeActions(actionIds) {
    return uniqueStrings(actionIds).filter((actionId) => FOOTBALL_ACTIONS.has(actionId));
}

function collectTargets(moduleInstance, page, actionIds) {
    if (!FOOTBALL_MODULE_IDS.has(getModuleId(moduleInstance))) return [];

    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    const config = getConfig(moduleInstance);
    // "leagues" (or any non-concrete value, incl. missing) => auto-detect the
    // domestic league from the configured team at execute time. A concrete
    // supported id (e.g. "champions") is used directly, unchanged.
    const rawLeagueId = normalizeText(config.leagueId || 'leagues');
    const leagueId = isSupportedLeague(rawLeagueId) ? rawLeagueId : null;
    const teamName = normalizeText(config.teamName);
    const leagueLabel = leagueId || 'leagues';

    return [targetBase('football', 'football', moduleInstance, page, teamName || `Football ${leagueLabel}`, {
        safeKey: `football:${leagueLabel}:${teamName.toLowerCase() || moduleInstanceId(moduleInstance)}`,
        leagueId,
        teamName,
        allowedAiActions,
    })];
}

function getToolDefinitions(targets) {
    const footballTargets = providerTargets({ targets }, 'football');
    if (footballTargets.length === 0) return [];

    const allowedModes = [];
    const allowedActions = unionAllowedActions(footballTargets);
    if (allowedActions.includes('football.team.summary')) allowedModes.push('team');
    if (allowedActions.includes('football.featured.summary')) allowedModes.push('featured');
    if (allowedActions.includes('football.standings')) allowedModes.push('standings');

    return [{
        type: 'function',
        function: {
            name: 'football_get_summary',
            description: 'Read football result, upcoming match, live match, or standings from configured Football widgets that expose AI actions.',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: allowedModes },
                    team: { type: 'string', description: 'Optional configured team name.' },
                },
            },
        },
    }];
}

function formatMatch(match) {
    if (!match) return null;
    const home = match.home?.team?.shortName || match.home?.team?.name || 'Local';
    const away = match.away?.team?.shortName || match.away?.team?.name || 'Visitante';
    const hasScore = match.home?.score !== null && match.home?.score !== undefined
        && match.away?.score !== null && match.away?.score !== undefined;
    const score = hasScore ? ` ${match.home.score}-${match.away.score}` : '';
    const when = match.startTimestamp
        ? new Date(match.startTimestamp).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
        : '';
    return `${home}${score} ${away}${when ? ` (${when})` : ''}`;
}

// In "leagues" mode target.leagueId is null; resolve the concrete domestic
// league from the team name (same engine the widget uses). Concrete ids
// (e.g. "champions") short-circuit and need no team.
async function resolveEffectiveLeague(target, teamName) {
    if (target.leagueId) return target.leagueId;
    if (!teamName) return null;
    try {
        const resolved = await footballService.resolveLeagueByTeam(teamName);
        return resolved.leagueId;
    } catch (err) {
        // Genuine "no such team" → soft null (caller shows the configure-team
        // hint). Transient/API errors propagate so safeExecute surfaces a
        // meaningful message instead of a misleading "configure a team".
        if (err && err.code === 'FOOTBALL_TEAM_NOT_FOUND') return null;
        throw err;
    }
}

async function execute(call, context) {
    if (call?.name !== 'football_get_summary') {
        return null;
    }

    return safeExecute(async () => {
        const mode = normalizeText(call.arguments?.mode || 'team');
        const team = normalizeText(call.arguments?.team);
        const target = providerTargets(context, 'football')
            .find((candidate) => !team || targetMatches(candidate, team));

        if (!target) {
            return errorResult('No encontre un widget de futbol configurado.');
        }

        if (mode === 'standings') {
            if (!target.allowedAiActions.includes('football.standings')) {
                return errorResult('Este widget de futbol no expone la clasificacion a Spark.');
            }

            const leagueId = await resolveEffectiveLeague(target, team || target.teamName);
            if (!leagueId) {
                return errorResult('Configura un equipo para ver su liga.');
            }
            const data = await footballService.getStandings(leagueId);
            const topRows = (data.rows || []).slice(0, 5)
                .map((row) => `${row.position}. ${row.team?.shortName || row.team?.name}: ${row.points} pts`);
            return okResult(`Clasificacion ${leagueId}: ${topRows.join(', ')}.`, data);
        }

        const teamName = team || target.teamName;
        if (mode !== 'featured' && teamName) {
            if (!target.allowedAiActions.includes('football.team.summary')) {
                return errorResult('Este widget de futbol no expone el resumen de equipo a Spark.');
            }

            const leagueId = await resolveEffectiveLeague(target, teamName);
            if (!leagueId) {
                return errorResult('Configura un equipo para ver su liga.');
            }
            const data = await footballService.getTeamSnapshotByName(leagueId, teamName);
            const live = formatMatch(data.liveMatch);
            const last = formatMatch(data.lastMatch);
            const next = formatMatch(data.nextMatch);
            const message = live
                ? `Partido en directo: ${live}.`
                : last
                    ? `Ultimo partido: ${last}.${next ? ` Proximo: ${next}.` : ''}`
                    : next
                        ? `Proximo partido: ${next}.`
                        : `No encontre partidos recientes para ${teamName}.`;
            return okResult(message, data);
        }

        if (!target.allowedAiActions.includes('football.featured.summary')) {
            return errorResult('Este widget de futbol no expone el partido destacado a Spark.');
        }

        const leagueId = await resolveEffectiveLeague(target, team || target.teamName);
        if (!leagueId) {
            return errorResult('Configura un equipo para ver su liga.');
        }
        const data = await footballService.getFeaturedMatch(leagueId);
        return okResult(formatMatch(data.match) || 'No encontre partido destacado ahora mismo.', data);
    });
}

function canExecute(name) {
    return name === 'football_get_summary';
}

function toSummary(target) {
    return {
        provider: target.provider,
        name: target.name || target.safeKey,
        safeKey: target.safeKey,
    };
}

module.exports = {
    canExecute,
    collectTargets,
    driverId: 'football',
    execute,
    getToolDefinitions,
    toSummary,
};
