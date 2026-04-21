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
    assert.ok(!capturedUrl.includes('feeds='), 'must not pass server-side feeds filter (it returns stale CS:GO items)');
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

test('fetchLatestUpdates filters out items with non-update feedname', async () => {
    const fakeFetch = async () => jsonResponse({
        appnews: {
            newsitems: [
                { gid: '1', title: 'Event', url: 'x', contents: '', date: 1, feedname: 'steam_community_announcements' },
                { gid: '2', title: 'Patch', url: 'y', contents: '', date: 2, feedname: 'patchnotes' },
                { gid: '3', title: 'Blog', url: 'z', contents: '', date: 3, feedname: 'external' },
                { gid: '4', title: 'Game X Update Released', url: 'w', contents: '', date: 4, feedname: 'steam_updates' },
            ],
        },
    });

    const provider = createSteamNewsProvider({ fetch: fakeFetch });
    const items = await provider.fetchLatestUpdates(730);

    assert.equal(items.length, 1, 'only steam_updates items pass when title does not look like update for community_announcements, and patchnotes is disabled');
    assert.equal(items[0].gid, '4');
});

test('fetchLatestUpdates drops patchnotes feedname items (updates only)', async () => {
    const fakeFetch = async () => jsonResponse({
        appnews: {
            newsitems: [
                { gid: '10', title: 'Patch 2.0', url: 'x', contents: '', date: 1, feedname: 'patchnotes' },
            ],
        },
    });

    const provider = createSteamNewsProvider({ fetch: fakeFetch });
    const items = await provider.fetchLatestUpdates(730);

    assert.deepEqual(items, []);
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

test('fetchLatestUpdates keeps steam_community_announcements items whose title looks like an update (CS2 case)', async () => {
    const fakeFetch = async () => jsonResponse({
        appnews: {
            newsitems: [
                {
                    gid: '1830163047267453',
                    title: 'Counter-Strike 2 Update',
                    url: 'https://steam/news/1830163047267453',
                    contents: 'Fixed a bug that removed the delay between burst fire bullets.',
                    date: 1776733888,
                    feedname: 'steam_community_announcements',
                },
                {
                    gid: '1829528821308514',
                    title: 'Animgraph 2 Beta Update',
                    url: 'https://steam/news/1829528821308514',
                    contents: 'All changes from the animgraph_2_beta build are now live.',
                    date: 1775776671,
                    feedname: 'steam_community_announcements',
                },
            ],
        },
    });

    const provider = createSteamNewsProvider({ fetch: fakeFetch });
    const items = await provider.fetchLatestUpdates(730);

    assert.equal(items.length, 2);
    assert.equal(items[0].gid, '1830163047267453');
    assert.equal(items[1].gid, '1829528821308514');
});

test('fetchLatestUpdates drops steam_community_announcements items whose title is not update-like', async () => {
    const fakeFetch = async () => jsonResponse({
        appnews: {
            newsitems: [
                { gid: '1', title: 'Major Championship Starts Today', url: 'x', contents: '', date: 1, feedname: 'steam_community_announcements' },
                { gid: '2', title: 'Summer Sale Live Now', url: 'y', contents: '', date: 2, feedname: 'steam_community_announcements' },
                { gid: '3', title: 'Counter-Strike 2 Update', url: 'z', contents: '', date: 3, feedname: 'steam_community_announcements' },
                { gid: '4', title: 'Hotfix deployed', url: 'w', contents: '', date: 4, feedname: 'steam_community_announcements' },
                { gid: '5', title: 'Release Notes 1.2', url: 'v', contents: '', date: 5, feedname: 'steam_community_announcements' },
            ],
        },
    });

    const provider = createSteamNewsProvider({ fetch: fakeFetch });
    const items = await provider.fetchLatestUpdates(730);

    assert.deepEqual(items.map((i) => i.gid), ['3', '4', '5']);
});
