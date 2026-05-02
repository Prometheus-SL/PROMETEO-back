const assert = require('node:assert/strict');
const test = require('node:test');

const {
    mergeAiActionsIntoModules,
} = require('../src/services/ai/backfillModuleAi');

test('mergeAiActionsIntoModules backfills missing ai actions from the module action map', () => {
    const originalModules = [
        {
            _id: 'spotify-module',
            meta: {
                id: 'spotify-widget',
                name: 'Spotify',
            },
            config: {},
        },
        {
            _id: 'weather-module',
            meta: {
                id: 'weather-widget',
                name: 'Weather',
                ai: {
                    actions: ['weather.current'],
                },
            },
            config: {},
        },
    ];

    const { modules, changedCount } = mergeAiActionsIntoModules(originalModules, new Map([
        ['spotify-widget', ['spotify.status', 'spotify.play']],
        ['weather-widget', ['weather.current']],
    ]));

    assert.equal(changedCount, 1);
    assert.deepEqual(modules[0].meta.ai, {
        actions: ['spotify.status', 'spotify.play'],
    });
    assert.deepEqual(modules[1].meta.ai, {
        actions: ['weather.current'],
    });
    assert.equal(originalModules[0].meta.ai, undefined);
});

test('mergeAiActionsIntoModules refreshes stale ai actions and ignores unknown modules', () => {
    const { modules, changedCount } = mergeAiActionsIntoModules([
        {
            _id: 'spotify-module',
            meta: {
                id: 'spotify-widget',
                name: 'Spotify',
                ai: {
                    actions: ['spotify.status'],
                },
            },
            config: {},
        },
        {
            _id: 'custom-module',
            meta: {
                id: 'custom-widget',
                name: 'Custom',
            },
            config: {},
        },
    ], new Map([
        ['spotify-widget', ['spotify.status', 'spotify.play']],
    ]));

    assert.equal(changedCount, 1);
    assert.deepEqual(modules[0].meta.ai, {
        actions: ['spotify.status', 'spotify.play'],
    });
    assert.equal(modules[1].meta.ai, undefined);
});
