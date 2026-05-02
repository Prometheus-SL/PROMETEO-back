const assert = require('node:assert/strict');
const test = require('node:test');
const mock = require('mock-require');

const AI_ACTIONS_BY_MODULE_ID = {
    'calendar-agenda-widget': ['google.summary.calendar'],
    'calendar-agenda-widget-compact': ['google.summary.calendar'],
    'creator-status-widget': ['creator.status'],
    'creator-status-widget-compact': ['creator.status'],
    'discord-widget': ['discord.guild.info'],
    'football-widget': ['football.team.summary', 'football.featured.summary', 'football.standings'],
    'football-widget-compact': ['football.team.summary', 'football.featured.summary', 'football.standings'],
    'github-pulse-widget': ['github.pulse'],
    'github-pulse-widget-compact': ['github.pulse'],
    'hermes-now-playing-widget': [
        'hermes.status.media',
        'hermes.command.media.refresh',
        'hermes.command.media.toggle_playback',
        'hermes.command.media.play',
        'hermes.command.media.pause',
        'hermes.command.media.next',
        'hermes.command.media.previous',
    ],
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
    'inbox-summary-widget': ['google.summary.inbox'],
    'inbox-summary-widget-compact': ['google.summary.inbox'],
    'lifx-widget': ['lighting.power.set'],
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
    'spotify-widget-compact': [
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
    'spotify-widget-queue': [
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
    'tasks-today-widget': ['google.summary.tasks'],
    'tasks-today-widget-compact': ['google.summary.tasks'],
    'weather-widget': ['weather.current'],
    'whatsapp-personal-widget': ['whatsapp.status', 'whatsapp.conversations.list'],
    'wled-compact': ['lighting.power.set', 'lighting.effect.next'],
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

function loadRegistryWithPages(pages) {
    const modulePath = '../src/services/spark/toolRegistry';
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

    delete require.cache[require.resolve(modulePath)];
    for (const path of [
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
    const registry = require(modulePath);

    return {
        registry,
        cleanup() {
            mock.stop(dashboardPath);
            delete require.cache[require.resolve(modulePath)];
            for (const path of [
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
        },
    };
}

test('Spark tool registry discovers LIFX and WLED light tools across owned dashboard pages', async (t) => {
    const { registry, cleanup } = loadRegistryWithPages([
        {
            _id: 'page-1',
            modules: [
                {
                    _id: 'lifx-module',
                    meta: moduleMeta('lifx-widget', 'LIFX'),
                    config: {
                        apiToken: 'secret-lifx-token',
                        groupFilter: 'Desk',
                    },
                },
            ],
        },
        {
            _id: 'page-2',
            modules: [
                {
                    _id: 'wled-module',
                    meta: moduleMeta('wled-controller', 'WLED'),
                    config: {
                        deviceIp: '192.168.1.55',
                        useSsl: false,
                    },
                },
            ],
        },
    ]);
    t.after(cleanup);

    const built = await registry.buildSparkToolContext({ _id: 'user-1' });

    assert.equal(built.tools.some((tool) => tool.function.name === 'lights_set_power'), true);
    assert.equal(built.tools.some((tool) => tool.function.name === 'wled_next_effect'), true);
    assert.equal(built.targets.length, 2);
    assert.equal(built.targets[0].provider, 'lifx');
    assert.equal(built.targets[1].provider, 'wled');
    assert.doesNotMatch(JSON.stringify(built.summary), /secret-lifx-token/);
    assert.doesNotMatch(JSON.stringify(built.tools), /secret-lifx-token/);
});

test('Spark tool registry ignores invalid light configs and dedupes WLED targets', async (t) => {
    const { registry, cleanup } = loadRegistryWithPages([
        {
            _id: 'page-1',
            modules: [
                {
                    _id: 'lifx-missing-token',
                    meta: moduleMeta('lifx-widget', 'LIFX'),
                    config: { groupFilter: 'Desk' },
                },
                {
                    _id: 'wled-a',
                    meta: moduleMeta('wled-controller', 'WLED'),
                    config: { deviceIp: '192.168.1.55', useSsl: false },
                },
                {
                    _id: 'wled-b',
                    meta: moduleMeta('wled-compact', 'WLED Compact'),
                    config: { deviceIp: '192.168.1.55', useSsl: false },
                },
            ],
        },
    ]);
    t.after(cleanup);

    const built = await registry.buildSparkToolContext({ _id: 'user-1' });

    assert.equal(built.targets.length, 1);
    assert.equal(built.targets[0].provider, 'wled');
    assert.equal(built.targets[0].safeKey, 'wled:http://192.168.1.55');
});

test('Spark tool registry discovers Spotify tools from widget-defined ai actions', async (t) => {
    const { registry, cleanup } = loadRegistryWithPages([
        {
            _id: 'page-spotify-ai',
            modules: [
                {
                    _id: 'spotify-module',
                    meta: {
                        id: 'spotify-widget',
                        name: 'Spotify',
                        entry: './index2x2.tsx',
                        ai: {
                            actions: [
                                'spotify.status',
                                'spotify.play',
                                'spotify.track.play',
                                'spotify.pause',
                                'spotify.next',
                                'spotify.previous',
                                'spotify.volume.set',
                                'spotify.shuffle.set',
                                'spotify.repeat.set',
                                'spotify.seek.by',
                            ],
                        },
                    },
                    config: {},
                },
            ],
        },
    ]);
    t.after(cleanup);

    const built = await registry.buildSparkToolContext({ _id: 'user-1' });
    const spotifyTool = built.tools.find((tool) => tool.function.name === 'spotify_control_playback');

    assert.ok(spotifyTool);
    assert.deepEqual(spotifyTool.function.parameters.properties.action.enum, [
        'status',
        'play',
        'play_track',
        'pause',
        'next',
        'previous',
        'set_volume',
        'set_shuffle',
        'set_repeat',
        'seek_by',
    ]);
    assert.equal(built.summary.some((target) => target.provider === 'spotify'), true);
});

test('Spark tool registry ignores widgets that do not persist ai actions in dashboard data', async (t) => {
    const { registry, cleanup } = loadRegistryWithPages([
        {
            _id: 'page-legacy-widget',
            modules: [
                {
                    _id: 'spotify-module',
                    meta: {
                        id: 'spotify-widget',
                        name: 'Spotify',
                        entry: './index2x2.tsx',
                    },
                    config: {},
                },
            ],
        },
    ]);
    t.after(cleanup);

    const built = await registry.buildSparkToolContext({ _id: 'user-1' });

    assert.equal(
        built.tools.some((tool) => tool.function.name === 'spotify_control_playback'),
        false,
    );
    assert.equal(built.summary.some((target) => target.provider === 'spotify'), false);
});

test('Spark tool registry discovers safe tools for every dashboard widget family', async (t) => {
    const { registry, cleanup } = loadRegistryWithPages([
        {
            _id: 'page-all',
            modules: [
                {
                    _id: 'weather-module',
                    meta: moduleMeta('weather-widget', 'Weather'),
                    config: { city: 'Madrid', units: 'metric', language: 'es' },
                },
                {
                    _id: 'football-module',
                    meta: moduleMeta('football-widget-compact', 'Football'),
                    config: { leagueId: 'laliga', teamName: 'Real Madrid' },
                },
                {
                    _id: 'minecraft-module',
                    meta: moduleMeta('minecraft-widget', 'Minecraft'),
                    config: { ipAddress: 'play.example.com', port: 25565, name: 'Survival' },
                },
                {
                    _id: 'spotify-module',
                    meta: moduleMeta('spotify-widget-queue', 'Spotify'),
                    config: {},
                },
                {
                    _id: 'calendar-module',
                    meta: moduleMeta('calendar-agenda-widget-compact', 'Calendar'),
                    config: { maxItems: 4 },
                },
                {
                    _id: 'tasks-module',
                    meta: moduleMeta('tasks-today-widget', 'Tasks'),
                    config: { maxItems: 3 },
                },
                {
                    _id: 'inbox-module',
                    meta: moduleMeta('inbox-summary-widget-compact', 'Inbox'),
                    config: { maxItems: 5 },
                },
                {
                    _id: 'github-module',
                    meta: moduleMeta('github-pulse-widget', 'GitHub'),
                    config: { maxItems: 6 },
                },
                {
                    _id: 'creator-module',
                    meta: moduleMeta('creator-status-widget-compact', 'Creator'),
                    config: {},
                },
                {
                    _id: 'whatsapp-module',
                    meta: moduleMeta('whatsapp-personal-widget', 'WhatsApp'),
                    config: { limit: 8, includeGroups: false },
                },
                {
                    _id: 'discord-module',
                    meta: moduleMeta('discord-widget', 'Discord'),
                    config: { serverId: 'guild-1' },
                },
                {
                    _id: 'hermes-system-module',
                    meta: moduleMeta('hermes-pc-widget', 'Hermes System'),
                    config: { mode: 'agent', agentId: 'pc-main' },
                },
                {
                    _id: 'hermes-media-module',
                    meta: moduleMeta('hermes-now-playing-widget', 'Hermes Media'),
                    config: { mode: 'auto' },
                },
                {
                    _id: 'hermes-volume-module',
                    meta: moduleMeta('hermes-volume-widget', 'Hermes Volume'),
                    config: { mode: 'auto' },
                },
            ],
        },
    ]);
    t.after(cleanup);

    const built = await registry.buildSparkToolContext({ _id: 'user-1' });
    const toolNames = built.tools.map((tool) => tool.function.name);
    const providers = new Set(built.summary.map((target) => target.provider));

    for (const expected of [
        'weather_get_current',
        'football_get_summary',
        'minecraft_get_status',
        'spotify_control_playback',
        'google_workspace_summary',
        'github_get_pulse',
        'creator_get_status',
        'whatsapp_get_status',
        'whatsapp_list_conversations',
        'discord_get_guild_info',
        'hermes_get_status',
        'hermes_control',
    ]) {
        assert.equal(toolNames.includes(expected), true, `${expected} should be exposed`);
    }

    for (const expectedProvider of [
        'weather',
        'football',
        'minecraft',
        'spotify',
        'google',
        'github',
        'creator',
        'whatsapp',
        'discord',
        'hermes',
    ]) {
        assert.equal(providers.has(expectedProvider), true, `${expectedProvider} target should be summarized`);
    }
});
