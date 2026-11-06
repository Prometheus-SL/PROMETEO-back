const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

test('initBot waits for the clientReady event, not the deprecated ready event', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const realDiscord = require('discord.js');
    const listened = [];

    class FakeClient extends EventEmitter {
        once(event, listener) {
            listened.push(event);
            return super.once(event, listener);
        }
        async login() { return 'token'; }
        isReady() { return false; }
    }

    const discordPath = require.resolve('discord.js');
    const clientPath = path.join(__dirname, '../src/services/discord/client.js');
    const originalDiscord = require.cache[discordPath];
    require.cache[discordPath] = { ...originalDiscord, exports: { ...realDiscord, Client: FakeClient } };
    delete require.cache[clientPath];
    t.after(() => {
        require.cache[discordPath] = originalDiscord;
        delete require.cache[clientPath];
    });

    process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'test-token';
    const { initBot } = require(clientPath);
    initBot().catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(listened.includes(realDiscord.Events.ClientReady));
    assert.equal(realDiscord.Events.ClientReady, 'clientReady');
    assert.ok(!listened.includes('ready'));
});
