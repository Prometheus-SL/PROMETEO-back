const assert = require('node:assert/strict');
const test = require('node:test');

const { SPOTIFY_SCOPES } = require('../src/services/spotifyIntegration');

test('Spotify OAuth scopes include Web Playback SDK streaming access', () => {
    assert.equal(SPOTIFY_SCOPES.includes('streaming'), true);
});
