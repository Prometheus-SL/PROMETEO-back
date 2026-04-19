const test = require('node:test');
const assert = require('node:assert/strict');

const { createSteamNewsProvider } = require('../src/services/discord/providers/steamNews');

function jsonResponse(body, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

test('fetchLatestUpdates returns normalized items', async () => {
    let capturedUrl = null;
    const fakeFetch = async (url) => {
        capturedUrl = url;
        return jsonResponse({
            appnews: {
                newsitems: [
                    {
                        gid: '111',
                        title: 'Patch 1.0',
                        url: 'https://steam/news/111',
                        contents: 'Fixed bugs',
                        date: 1700000000,
                        feedname: 'steam_updates',
                    },
                ],
            },
        });
    };

    const provider = createSteamNewsProvider({ fetch: fakeFetch });
    const items = await provider.fetchLatestUpdates(730, { limit: 5 });

    assert.ok(capturedUrl.includes('appid=730'));
    assert.ok(capturedUrl.includes('count=5'));
    assert.ok(capturedUrl.includes('feeds=steam_updates%2Cpatchnotes'));
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
        gid: '111',
        title: 'Patch 1.0',
        url: 'https://steam/news/111',
        contents: 'Fixed bugs',
        date: new Date(1700000000 * 1000),
        feedname: 'steam_updates',
    });
});

test('fetchLatestUpdates filters out items with non-patch feedname', async () => {
    const fakeFetch = async () => jsonResponse({
        appnews: {
            newsitems: [
                { gid: '1', title: 'Event', url: 'x', contents: '', date: 1, feedname: 'steam_community_announcements' },
                { gid: '2', title: 'Patch', url: 'y', contents: '', date: 2, feedname: 'patchnotes' },
                { gid: '3', title: 'Blog', url: 'z', contents: '', date: 3, feedname: 'external' },
            ],
        },
    });

    const provider = createSteamNewsProvider({ fetch: fakeFetch });
    const items = await provider.fetchLatestUpdates(730);

    assert.equal(items.length, 1);
    assert.equal(items[0].gid, '2');
});

test('fetchLatestUpdates throws on HTTP error', async () => {
    const fakeFetch = async () => jsonResponse({}, { status: 500 });
    const provider = createSteamNewsProvider({ fetch: fakeFetch });

    await assert.rejects(
        () => provider.fetchLatestUpdates(730),
        /Steam News API returned 500/,
    );
});

test('fetchLatestUpdates returns [] when appnews.newsitems is missing', async () => {
    const fakeFetch = async () => jsonResponse({ appnews: {} });
    const provider = createSteamNewsProvider({ fetch: fakeFetch });

    const items = await provider.fetchLatestUpdates(730);
    assert.deepEqual(items, []);
});
