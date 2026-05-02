const spotify = require('../../spotifyIntegration');

const SPOTIFY_ACTION_MAP = {
    'spotify.status': {
        toolAction: 'status',
    },
    'spotify.play': {
        toolAction: 'play',
    },
    'spotify.track.play': {
        toolAction: 'play_track',
    },
    'spotify.pause': {
        toolAction: 'pause',
    },
    'spotify.next': {
        toolAction: 'next',
    },
    'spotify.previous': {
        toolAction: 'previous',
    },
    'spotify.volume.up': {
        toolAction: 'volume_up',
    },
    'spotify.volume.down': {
        toolAction: 'volume_down',
    },
    'spotify.volume.set': {
        toolAction: 'set_volume',
    },
    'spotify.shuffle.set': {
        toolAction: 'set_shuffle',
    },
    'spotify.repeat.set': {
        toolAction: 'set_repeat',
    },
    'spotify.seek.to': {
        toolAction: 'seek_to',
    },
    'spotify.seek.by': {
        toolAction: 'seek_by',
    },
};

const TOOL_ACTION_TO_AI_ACTION = Object.fromEntries(
    Object.entries(SPOTIFY_ACTION_MAP).map(([aiAction, config]) => [config.toolAction, aiAction])
);

function normalizeText(value) {
    return String(value || '').trim();
}

function clampNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function moduleInstanceId(moduleInstance) {
    return String(moduleInstance?._id || moduleInstance?.id || moduleInstance?.meta?.id || '');
}

function normalizeActions(actionIds) {
    return Array.from(new Set(
        (Array.isArray(actionIds) ? actionIds : [])
            .map((actionId) => normalizeText(actionId))
            .filter((actionId) => actionId && SPOTIFY_ACTION_MAP[actionId])
    ));
}

function unionAllowedActions(targets) {
    return Array.from(new Set(
        targets.flatMap((target) => Array.isArray(target.allowedAiActions) ? target.allowedAiActions : [])
    ));
}

function providerTargets(context) {
    return (context.targets || []).filter((target) => target.provider === 'spotify' && target.aiDriverId === 'spotify');
}

function isAllowed(context, toolAction) {
    const aiAction = TOOL_ACTION_TO_AI_ACTION[toolAction];
    if (!aiAction) return false;
    return unionAllowedActions(providerTargets(context)).includes(aiAction);
}

function spotifyTrackName(state) {
    const item = state?.item;
    if (!item) return 'Spotify no esta reproduciendo nada ahora mismo';
    const artists = Array.isArray(item.artists)
        ? item.artists.map((artist) => artist.name).filter(Boolean).join(', ')
        : '';
    return `${item.name || 'Pista'}${artists ? ` de ${artists}` : ''}`;
}

function clampSpotifyPosition(positionMs, durationMs) {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) {
        return Math.max(0, Math.floor(positionMs));
    }

    return Math.max(0, Math.min(Math.floor(positionMs), Math.floor(duration)));
}

function okResult(message, data = null) {
    return { success: true, message, clientActions: [], data };
}

function errorResult(message, data = null) {
    return { success: false, message, clientActions: [], data };
}

async function safeExecute(fn) {
    try {
        return await fn();
    } catch (error) {
        return errorResult(error?.message || 'La herramienta fallo al ejecutarse.');
    }
}

function collectTargets(moduleInstance, page, actionIds) {
    const allowedAiActions = normalizeActions(actionIds);
    if (allowedAiActions.length === 0) return [];

    return [{
        provider: 'spotify',
        aiDriverId: 'spotify',
        moduleId: moduleInstanceId(moduleInstance),
        pageId: String(page?._id || ''),
        safeKey: `spotify:${moduleInstanceId(moduleInstance) || 'playback'}`,
        name: 'Spotify',
        allowedAiActions,
    }];
}

function getToolDefinitions(targets) {
    const spotifyTargets = targets.filter((target) => target.provider === 'spotify' && target.aiDriverId === 'spotify');
    if (spotifyTargets.length === 0) {
        return [];
    }

    const allowedToolActions = unionAllowedActions(spotifyTargets)
        .map((actionId) => SPOTIFY_ACTION_MAP[actionId]?.toolAction)
        .filter(Boolean);

    return [{
        type: 'function',
        function: {
            name: 'spotify_control_playback',
            description: 'Control or inspect Spotify playback for configured Spotify widgets that expose AI actions.',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: allowedToolActions,
                    },
                    query: {
                        type: 'string',
                        description: 'Song, track, or artist request to search and play when the user asks for a specific song.',
                    },
                    volumePercent: { type: 'number', minimum: 0, maximum: 100 },
                    enabled: { type: 'boolean', description: 'Required for set_shuffle.' },
                    repeatMode: { type: 'string', enum: ['off', 'track', 'context'] },
                    positionMs: { type: 'number', minimum: 0, description: 'Required for seek_to.' },
                    offsetSeconds: { type: 'number', minimum: -3600, maximum: 3600, description: 'Required for seek_by.' },
                },
                required: ['action'],
            },
        },
    }];
}

async function execute(call, context) {
    if (call?.name !== 'spotify_control_playback') {
        return null;
    }

    return safeExecute(async () => {
        if (providerTargets(context).length === 0) {
            return null;
        }

        const action = normalizeText(call.arguments?.action || 'status');
        if (!isAllowed(context, action)) {
            return errorResult('Ese control de Spotify no esta expuesto por este widget para Spark.');
        }

        if (action === 'status') {
            const data = await spotify.getSpotifyPlaybackState(context.user);
            return okResult(`Spotify: ${spotifyTrackName(data)}.`, data);
        }
        if (action === 'play') {
            await spotify.playSpotify(context.user);
            return okResult('Spotify reanudado.');
        }
        if (action === 'play_track') {
            const query = normalizeText(call.arguments?.query);
            if (!query) {
                return errorResult('Indica la cancion o artista que quieres poner en Spotify.');
            }

            const search = await spotify.searchSpotify(context.user, query, 'track', 5, 0);
            const track = Array.isArray(search?.tracks?.items) ? search.tracks.items[0] : null;
            if (!track?.uri) {
                return errorResult(`No encontre una cancion de Spotify para "${query}".`);
            }

            const artistName = Array.isArray(track.artists)
                ? track.artists.map((artist) => artist?.name).filter(Boolean).join(', ')
                : '';

            return {
                success: true,
                message: `Preparando Spotify para reproducir ${track.name || 'la cancion solicitada'}${artistName ? ` de ${artistName}` : ''} en el reproductor interno.`,
                clientActions: [{
                    id: `${call.toolCallId || 'call'}:${track.uri}`,
                    provider: 'spotify',
                    type: 'spotify.play_track',
                    payload: {
                        uri: track.uri,
                        query,
                        trackId: track.id || null,
                        trackName: track.name || null,
                        artistName: artistName || null,
                    },
                }],
                data: {
                    query,
                    track: {
                        id: track.id || null,
                        uri: track.uri,
                        name: track.name || null,
                        artistName: artistName || null,
                    },
                },
            };
        }
        if (action === 'pause') {
            await spotify.pauseSpotify(context.user);
            return okResult('Spotify pausado.');
        }
        if (action === 'next') {
            await spotify.nextSpotifyTrack(context.user);
            return okResult('Saltando a la siguiente pista.');
        }
        if (action === 'previous') {
            await spotify.previousSpotifyTrack(context.user);
            return okResult('Volviendo a la pista anterior.');
        }
        if (action === 'set_volume') {
            const volume = clampNumber(call.arguments?.volumePercent, NaN, 0, 100);
            if (!Number.isFinite(volume)) return errorResult('Indica un volumen entre 0 y 100.');
            await spotify.setSpotifyVolume(context.user, volume);
            return okResult(`Volumen de Spotify ajustado al ${Math.round(volume)}%.`);
        }
        if (action === 'volume_up' || action === 'volume_down') {
            const state = await spotify.getSpotifyPlaybackState(context.user);
            const current = Number(state?.device?.volume_percent);
            if (!Number.isFinite(current)) return errorResult('No pude leer el volumen actual de Spotify.');
            const next = Math.max(0, Math.min(100, current + (action === 'volume_up' ? 10 : -10)));
            await spotify.setSpotifyVolume(context.user, next);
            return okResult(`Volumen de Spotify ajustado al ${next}%.`);
        }
        if (action === 'set_shuffle') {
            if (typeof call.arguments?.enabled !== 'boolean') {
                return errorResult('Indica si quieres activar o desactivar shuffle.');
            }

            await spotify.setSpotifyShuffle(context.user, call.arguments.enabled);
            return okResult(`Shuffle de Spotify ${call.arguments.enabled ? 'activado' : 'desactivado'}.`);
        }
        if (action === 'set_repeat') {
            const repeatMode = normalizeText(call.arguments?.repeatMode).toLowerCase();
            if (!['off', 'track', 'context'].includes(repeatMode)) {
                return errorResult('Indica un modo repeat valido: off, track o context.');
            }

            await spotify.setSpotifyRepeat(context.user, repeatMode);
            return okResult(`Modo repeat de Spotify: ${repeatMode}.`);
        }
        if (action === 'seek_to') {
            const positionMs = Number(call.arguments?.positionMs);
            if (!Number.isFinite(positionMs) || positionMs < 0) {
                return errorResult('Indica una posicion en milisegundos valida.');
            }

            const state = await spotify.getSpotifyPlaybackState(context.user);
            const nextPosition = clampSpotifyPosition(positionMs, state?.item?.duration_ms);
            await spotify.seekSpotify(context.user, nextPosition);
            return okResult(`Spotify movido a ${Math.round(nextPosition / 1000)} segundos.`);
        }
        if (action === 'seek_by') {
            const offsetSeconds = Number(call.arguments?.offsetSeconds);
            if (!Number.isFinite(offsetSeconds) || offsetSeconds === 0) {
                return errorResult('Indica un desplazamiento en segundos distinto de 0.');
            }

            const state = await spotify.getSpotifyPlaybackState(context.user);
            const current = Number(state?.progress_ms);
            if (!Number.isFinite(current)) {
                return errorResult('No pude leer la posicion actual de Spotify.');
            }

            const nextPosition = clampSpotifyPosition(
                current + Math.round(offsetSeconds * 1000),
                state?.item?.duration_ms
            );
            await spotify.seekSpotify(context.user, nextPosition);
            return okResult(
                `Spotify ${offsetSeconds > 0 ? 'avanzado' : 'retrocedido'} ${Math.abs(Math.round(offsetSeconds))} segundos.`
            );
        }

        return errorResult('Accion de Spotify no soportada.');
    });
}

function canExecute(name) {
    return name === 'spotify_control_playback';
}

function toSummary(target) {
    return {
        provider: target.provider,
        name: target.name || 'Spotify',
        safeKey: target.safeKey,
    };
}

module.exports = {
    canExecute,
    collectTargets,
    driverId: 'spotify',
    execute,
    getToolDefinitions,
    toSummary,
};
