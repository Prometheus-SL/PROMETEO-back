const assert = require('node:assert/strict');
const test = require('node:test');
const mock = require('mock-require');

const AI_ACTIONS_BY_MODULE_ID = {
    'hermes-pc-widget': ['hermes.status.system'],
    'hermes-volume-widget': [
        'hermes.status.audio',
        'hermes.command.volume.set',
        'hermes.command.volume.mute',
        'hermes.command.volume.unmute',
        'hermes.command.volume.up',
        'hermes.command.volume.down',
        'hermes.command.audio_output.set',
    ],
    'minecraft-widget': ['minecraft.status'],
    'spotify-widget': [
        'spotify.status',
        'spotify.play',
        'spotify.track.play',
        'spotify.pause',
        'spotify.next',
        'spotify.previous',
        'spotify.volume.up',
        'spotify.volume.down',
        'spotify.volume.set',
        'spotify.shuffle.set',
        'spotify.repeat.set',
        'spotify.seek.to',
        'spotify.seek.by',
    ],
    'weather-widget': ['weather.current'],
    'wled-controller': ['lighting.power.set', 'lighting.effect.next'],
};

function moduleMeta(id, name) {
    return {
        id,
        name,
        ai: {
            actions: AI_ACTIONS_BY_MODULE_ID[id] || [],
        },
    };
}

function clearSparkModules() {
    for (const path of [
        '../src/services/spark/toolRegistry',
        '../src/services/ai/widgetRegistry',
        '../src/services/ai/drivers/index',
        '../src/services/ai/drivers/lighting',
        '../src/services/ai/drivers/weather',
        '../src/services/ai/drivers/football',
        '../src/services/ai/drivers/minecraft',
        '../src/services/ai/drivers/spotify',
        '../src/services/ai/drivers/google',
        '../src/services/ai/drivers/github',
        '../src/services/ai/drivers/creator',
        '../src/services/ai/drivers/whatsapp',
        '../src/services/ai/drivers/discord',
        '../src/services/ai/drivers/hermes',
    ]) {
        try {
            delete require.cache[require.resolve(path)];
        } catch (_error) {
            // Module may not have been loaded yet.
        }
    }
}

function loadRegistry({ pages, mocks = {} }) {
    const dashboardPath = '../src/models/DashboardPage';

    mock(dashboardPath, {
        find(filter) {
            return {
                lean: async () => {
                    assert.deepEqual(filter, { user: 'user-1' });
                    return pages;
                },
            };
        },
    });

    for (const [path, value] of Object.entries(mocks)) {
        mock(path, value);
    }

    clearSparkModules();
    const registry = require('../src/services/spark/toolRegistry');

    return {
        registry,
        cleanup() {
            mock.stopAll();
            clearSparkModules();
        },
    };
}

test('weather_get_current uses the saved Weather widget config', async (t) => {
    let receivedWeatherRequest = null;
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-weather',
            modules: [{
                _id: 'weather-module',
                meta: moduleMeta('weather-widget', 'Weather'),
                config: { city: 'Madrid', units: 'metric', language: 'es' },
            }],
        }],
        mocks: {
            '../src/services/weatherIntegration': {
                getCurrentWeather: async (payload) => {
                    receivedWeatherRequest = payload;
                    return {
                        name: 'Madrid',
                        weather: [{ description: 'cielo claro' }],
                        main: { temp: 21.4, humidity: 40 },
                    };
                },
            },
        },
    });
    t.after(cleanup);

    const context = await registry.buildSparkToolContext({ _id: 'user-1' });
    const result = await registry.executeSparkTool({
        name: 'weather_get_current',
        arguments: {},
    }, context);

    assert.equal(result.success, true);
    assert.deepEqual(receivedWeatherRequest, {
        city: 'Madrid',
        units: 'metric',
        language: 'es',
    });
    assert.match(result.message, /Madrid: 21 grados/i);
});

test('spotify_control_playback dispatches playback actions through the backend Spotify service', async (t) => {
    let receivedUser = null;
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-spotify',
            modules: [{
                _id: 'spotify-module',
                meta: moduleMeta('spotify-widget', 'Spotify'),
                config: {},
            }],
        }],
        mocks: {
            '../src/services/spotifyIntegration': {
                getSpotifyPlaybackState: async () => null,
                nextSpotifyTrack: async (user) => {
                    receivedUser = user;
                },
                pauseSpotify: async () => {},
                playSpotify: async () => {},
                previousSpotifyTrack: async () => {},
                setSpotifyVolume: async () => {},
            },
        },
    });
    t.after(cleanup);

    const user = { _id: 'user-1', username: 'migue' };
    const context = await registry.buildSparkToolContext(user);
    const result = await registry.executeSparkTool({
        name: 'spotify_control_playback',
        arguments: { action: 'next' },
    }, context);

    assert.equal(result.success, true);
    assert.equal(result.message, 'Saltando a la siguiente pista.');
    assert.equal(receivedUser, user);
});

test('spotify_control_playback can be declared directly from widget meta.ai actions', async (t) => {
    let receivedUser = null;
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-spotify',
            modules: [{
                _id: 'spotify-module',
                meta: {
                    id: 'spotify-widget',
                    name: 'Spotify',
                    entry: './index2x2.tsx',
                    ai: {
                        actions: ['spotify.play', 'spotify.pause', 'spotify.next'],
                    },
                },
                config: {},
            }],
        }],
        mocks: {
            '../src/services/spotifyIntegration': {
                getSpotifyPlaybackState: async () => null,
                nextSpotifyTrack: async (user) => {
                    receivedUser = user;
                },
                pauseSpotify: async () => {},
                playSpotify: async () => {},
                previousSpotifyTrack: async () => {},
                seekSpotify: async () => {},
                setSpotifyRepeat: async () => {},
                setSpotifyShuffle: async () => {},
                setSpotifyVolume: async () => {},
            },
        },
    });
    t.after(cleanup);

    const user = { _id: 'user-1', username: 'migue' };
    const context = await registry.buildSparkToolContext(user);
    const result = await registry.executeSparkTool({
        name: 'spotify_control_playback',
        arguments: { action: 'next' },
    }, context);

    assert.equal(result.success, true);
    assert.equal(result.message, 'Saltando a la siguiente pista.');
    assert.equal(receivedUser, user);
});

test('spotify_control_playback supports shuffle, repeat, and relative seek actions', async (t) => {
    const calls = {
        repeat: [],
        seek: [],
        shuffle: [],
    };
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-spotify',
            modules: [{
                _id: 'spotify-module',
                meta: moduleMeta('spotify-widget', 'Spotify'),
                config: {},
            }],
        }],
        mocks: {
            '../src/services/spotifyIntegration': {
                getSpotifyPlaybackState: async () => ({
                    progress_ms: 90_000,
                    item: { duration_ms: 240_000 },
                }),
                nextSpotifyTrack: async () => {},
                pauseSpotify: async () => {},
                playSpotify: async () => {},
                previousSpotifyTrack: async () => {},
                seekSpotify: async (_user, positionMs) => {
                    calls.seek.push(positionMs);
                },
                setSpotifyRepeat: async (_user, mode) => {
                    calls.repeat.push(mode);
                },
                setSpotifyShuffle: async (_user, enabled) => {
                    calls.shuffle.push(enabled);
                },
                setSpotifyVolume: async () => {},
            },
        },
    });
    t.after(cleanup);

    const user = { _id: 'user-1', username: 'migue' };
    const context = await registry.buildSparkToolContext(user);

    const shuffleResult = await registry.executeSparkTool({
        name: 'spotify_control_playback',
        arguments: { action: 'set_shuffle', enabled: true },
    }, context);
    const repeatResult = await registry.executeSparkTool({
        name: 'spotify_control_playback',
        arguments: { action: 'set_repeat', repeatMode: 'track' },
    }, context);
    const seekResult = await registry.executeSparkTool({
        name: 'spotify_control_playback',
        arguments: { action: 'seek_by', offsetSeconds: 30 },
    }, context);

    assert.equal(shuffleResult.success, true);
    assert.equal(shuffleResult.message, 'Shuffle de Spotify activado.');
    assert.deepEqual(calls.shuffle, [true]);

    assert.equal(repeatResult.success, true);
    assert.equal(repeatResult.message, 'Modo repeat de Spotify: track.');
    assert.deepEqual(calls.repeat, ['track']);

    assert.equal(seekResult.success, true);
    assert.equal(seekResult.message, 'Spotify avanzado 30 segundos.');
    assert.deepEqual(calls.seek, [120000]);
});

test('spotify_control_playback can search a requested track and hand it off to the internal web player', async (t) => {
    const calls = {
        search: [],
    };
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-spotify',
            modules: [{
                _id: 'spotify-module',
                meta: moduleMeta('spotify-widget', 'Spotify'),
                config: {},
            }],
        }],
        mocks: {
            '../src/services/spotifyIntegration': {
                getSpotifyPlaybackState: async () => null,
                nextSpotifyTrack: async () => {},
                pauseSpotify: async () => {},
                playSpotify: async () => {},
                playSpotifyTrack: async () => {
                    throw new Error('playSpotifyTrack should not be used when Spark targets the internal player');
                },
                previousSpotifyTrack: async () => {},
                searchSpotify: async (_user, query) => {
                    calls.search.push(query);
                    return {
                        tracks: {
                            items: [{
                                id: 'track-1',
                                uri: 'spotify:track:track-1',
                                name: 'Time',
                                artists: [{ name: 'Pink Floyd' }],
                            }],
                        },
                    };
                },
                seekSpotify: async () => {},
                setSpotifyRepeat: async () => {},
                setSpotifyShuffle: async () => {},
                setSpotifyVolume: async () => {},
            },
        },
    });
    t.after(cleanup);

    const user = { _id: 'user-1', username: 'migue' };
    const context = await registry.buildSparkToolContext(user);
    const result = await registry.executeSparkTool({
        name: 'spotify_control_playback',
        toolCallId: 'call-spotify-search',
        arguments: { action: 'play_track', query: 'time pink floyd' },
    }, context);

    assert.equal(result.success, true);
    assert.match(result.message, /Preparando Spotify/i);
    assert.deepEqual(calls.search, ['time pink floyd']);
    assert.equal(result.clientActions.length, 1);
    assert.deepEqual(result.clientActions[0], {
        id: 'call-spotify-search:spotify:track:track-1',
        provider: 'spotify',
        type: 'spotify.play_track',
        payload: {
            uri: 'spotify:track:track-1',
            query: 'time pink floyd',
            trackId: 'track-1',
            trackName: 'Time',
            artistName: 'Pink Floyd',
        },
    });
});

test('minecraft_get_status uses a timeout signal for remote status fetches', async (t) => {
    const originalFetch = global.fetch;
    let receivedSignal = null;
    global.fetch = async (_url, init = {}) => {
        receivedSignal = init.signal;
        return new Response(JSON.stringify({
            online: true,
            players: { online: 2, max: 20, list: [{ name_raw: 'Alex' }] },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-minecraft',
            modules: [{
                _id: 'minecraft-module',
                meta: moduleMeta('minecraft-widget', 'Minecraft'),
                config: { ipAddress: 'play.example.com', port: 25565, name: 'Survival' },
            }],
        }],
    });
    t.after(cleanup);

    const context = await registry.buildSparkToolContext({ _id: 'user-1' });
    const result = await registry.executeSparkTool({
        name: 'minecraft_get_status',
        arguments: {},
    }, context);

    assert.equal(result.success, true);
    assert.ok(receivedSignal);
});

test('wled_next_effect creates a browser action for configured WLED widgets', async (t) => {
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-wled',
            modules: [{
                _id: 'wled-module',
                meta: moduleMeta('wled-controller', 'WLED'),
                config: { deviceIp: '192.168.1.55', useSsl: false },
            }],
        }],
    });
    t.after(cleanup);

    const context = await registry.buildSparkToolContext({ _id: 'user-1' });
    const result = await registry.executeSparkTool({
        name: 'wled_next_effect',
        toolCallId: 'call-1',
        arguments: {},
    }, context);

    assert.equal(result.success, true);
    assert.equal(result.clientActions.length, 1);
    assert.equal(result.clientActions[0].type, 'wled.next_effect');
    assert.deepEqual(result.clientActions[0].payload, {
        deviceIp: '192.168.1.55',
        useSsl: false,
    });
});

test('hermes_control refuses an explicit agent id that is not owned by the user', async (t) => {
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-hermes',
            modules: [{
                _id: 'hermes-module',
                meta: moduleMeta('hermes-volume-widget', 'Hermes Volume'),
                config: { mode: 'auto' },
            }],
        }],
        mocks: {
            '../src/models/Agent': {
                findOne: async (query) => {
                    assert.equal(query.agentId, 'someone-elses-pc');
                    assert.equal(query.user, 'user-1');
                    return null;
                },
                find: () => {
                    throw new Error('Hermes should not fall back to another agent for an explicit agentId');
                },
            },
            '../src/models/Command': class CommandMock {},
            '../src/services/notifications': { getIo: () => null },
        },
    });
    t.after(cleanup);

    const context = await registry.buildSparkToolContext({ _id: 'user-1', username: 'migue' });
    const result = await registry.executeSparkTool({
        name: 'hermes_control',
        arguments: { command: 'volume_down', agentId: 'someone-elses-pc' },
    }, context);

    assert.equal(result.success, false);
    assert.match(result.message, /No encontre un agente Hermes/i);
});

test('hermes_get_status never exposes stored agent api keys', async (t) => {
    const { registry, cleanup } = loadRegistry({
        pages: [{
            _id: 'page-hermes',
            modules: [{
                _id: 'hermes-module',
                meta: moduleMeta('hermes-pc-widget', 'Hermes System'),
                config: { mode: 'agent', agentId: 'pc-main' },
            }],
        }],
        mocks: {
            '../src/models/Agent': {
                findOne: async () => ({
                    agentId: 'pc-main',
                    name: 'Main PC',
                    status: 'online',
                    apiKey: 'super-secret-agent-key',
                    user: 'user-1',
                }),
                find: () => {
                    throw new Error('Specific Hermes agent should use findOne');
                },
            },
            '../src/models/AgentData': {
                findOne: () => ({
                    sort: () => ({
                        lean: async () => ({
                            data: {
                                dataType: 'system_status',
                                resources: {
                                    cpu: { percent: 12 },
                                    memory: { percent: 34 },
                                },
                            },
                        }),
                    }),
                }),
            },
        },
    });
    t.after(cleanup);

    const context = await registry.buildSparkToolContext({ _id: 'user-1', username: 'migue' });
    const result = await registry.executeSparkTool({
        name: 'hermes_get_status',
        arguments: { area: 'system' },
    }, context);

    assert.equal(result.success, true);
    assert.equal(result.data.agent.agentId, 'pc-main');
    assert.doesNotMatch(JSON.stringify(result.data), /super-secret-agent-key/);
    assert.equal(Object.prototype.hasOwnProperty.call(result.data.agent, 'apiKey'), false);
});
