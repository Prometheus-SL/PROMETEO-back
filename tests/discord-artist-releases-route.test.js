const assert = require('node:assert/strict');
const test = require('node:test');

test('discord artist releases routes', async (t) => {
    await t.test('routes are properly exported', async () => {
        const router = require('../src/routes/discord.js');
        assert.ok(router);
        // Basic check that it's an Express router
        assert.ok(typeof router === 'object' || typeof router === 'function');
    });

    await t.test('route file includes artist releases imports', async () => {
        // This is a basic sanity check that the routes file was modified correctly
        const routeFile = require('fs').readFileSync(
            require('path').join(__dirname, '../src/routes/discord.js'),
            'utf8'
        );
        assert.ok(routeFile.includes('artistReleasesService'));
        assert.ok(routeFile.includes('/artists/search'));
        assert.ok(routeFile.includes('/notifications/artist-releases'));
    });

    await t.test('discord client imports spotify scheduler', async () => {
        const clientFile = require('fs').readFileSync(
            require('path').join(__dirname, '../src/services/discord/client.js'),
            'utf8'
        );
        assert.ok(clientFile.includes('createArtistReleasesScheduler'));
        assert.ok(clientFile.includes('SPOTIFY'));
    });
});
