const assert = require('node:assert/strict');
const test = require('node:test');

const { parseSteamInventory } = require('../src/services/steamIntegration');

const SAMPLE_PAYLOAD = {
    success: true,
    assets: [
        { appid: 730, contextid: '2', assetid: '111', classid: 'C1', instanceid: 'I1' },
        { appid: 730, contextid: '2', assetid: '222', classid: 'C1', instanceid: 'I1' },
        { appid: 730, contextid: '2', assetid: '333', classid: 'C2', instanceid: 'I2' },
    ],
    descriptions: [
        {
            appid: 730, classid: 'C1', instanceid: 'I1',
            name: 'AK-47 | Redline',
            market_name: 'AK-47 | Redline (Field-Tested)',
            market_hash_name: 'AK-47 | Redline (Field-Tested)',
            type: 'Classified Rifle',
            icon_url: 'iconA',
            icon_url_large: 'iconAL',
            marketable: 1,
            tradable: 1,
            tags: [
                { category: 'Rarity', localized_category_name: 'Quality', localized_tag_name: 'Classified', color: 'd32ce6' },
            ],
            descriptions: [
                { type: 'html', value: 'Exterior: Field-Tested', color: '' },
            ],
        },
        {
            appid: 730, classid: 'C2', instanceid: 'I2',
            name: 'Souvenir Sticker',
            market_name: 'Souvenir Sticker',
            market_hash_name: 'Souvenir Sticker',
            type: 'High Grade Sticker',
            icon_url: 'iconB',
            icon_url_large: 'iconBL',
            marketable: 0,
            tradable: 0,
            tags: [],
            descriptions: [],
        },
    ],
};

test('parseSteamInventory returns one entry per (classid, instanceid) and counts quantity', () => {
    const items = parseSteamInventory(SAMPLE_PAYLOAD, { appId: '730' });

    assert.equal(items.length, 2);
    const redline = items.find((it) => it.id === '730_C1_I1');
    assert.ok(redline);
    assert.equal(redline.quantity, 2);
    assert.equal(redline.marketHashName, 'AK-47 | Redline (Field-Tested)');
    assert.equal(redline.marketable, true);
    assert.equal(redline.tradable, true);
});

test('parseSteamInventory builds full image URLs from icon_url', () => {
    const [first] = parseSteamInventory(SAMPLE_PAYLOAD, { appId: '730' });
    assert.equal(
        first.iconUrl,
        'https://community.akamai.steamstatic.com/economy/image/iconA/360fx360f',
    );
    assert.equal(
        first.iconUrlLarge,
        'https://community.akamai.steamstatic.com/economy/image/iconAL/360fx360f',
    );
});

test('parseSteamInventory exposes rarityColor from the Rarity tag', () => {
    const [first] = parseSteamInventory(SAMPLE_PAYLOAD, { appId: '730' });
    assert.equal(first.rarityColor, '#d32ce6');
});

test('parseSteamInventory marks unmarketable items and keeps them in the list', () => {
    const items = parseSteamInventory(SAMPLE_PAYLOAD, { appId: '730' });
    const sticker = items.find((it) => it.id === '730_C2_I2');
    assert.ok(sticker);
    assert.equal(sticker.marketable, false);
    assert.equal(sticker.tradable, false);
    assert.equal(sticker.quantity, 1);
});

test('parseSteamInventory builds a marketUrl that URL-encodes market_hash_name', () => {
    const [first] = parseSteamInventory(SAMPLE_PAYLOAD, { appId: '730' });
    assert.equal(
        first.marketUrl,
        'https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20(Field-Tested)',
    );
});

test('parseSteamInventory returns [] for a missing or unsuccessful payload', () => {
    assert.deepEqual(parseSteamInventory(null, { appId: '730' }), []);
    assert.deepEqual(parseSteamInventory({ success: false }, { appId: '730' }), []);
    assert.deepEqual(parseSteamInventory({ success: true, assets: [], descriptions: [] }, { appId: '730' }), []);
});

test('parseSteamInventory tracks the highest assetid per stack as latestAssetId', () => {
    const payload = {
        success: true,
        assets: [
            { appid: 730, classid: 'C1', instanceid: 'I1', assetid: '100' },
            { appid: 730, classid: 'C1', instanceid: 'I1', assetid: '500' },
            { appid: 730, classid: 'C1', instanceid: 'I1', assetid: '300' },
        ],
        descriptions: [
            { classid: 'C1', instanceid: 'I1', market_hash_name: 'X', marketable: 1, tradable: 1 },
        ],
    };
    const items = parseSteamInventory(payload, { appId: '730' });
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 3);
    assert.equal(items[0].latestAssetId, '500');
});

test('parseSteamInventory silently skips assets that have no matching description', () => {
    const payload = {
        success: true,
        assets: [
            { appid: 730, contextid: '2', assetid: '999', classid: 'CMISSING', instanceid: 'IMISSING' },
            { appid: 730, contextid: '2', assetid: '111', classid: 'C1', instanceid: 'I1' },
        ],
        descriptions: [
            {
                appid: 730, classid: 'C1', instanceid: 'I1',
                name: 'AK-47',
                market_hash_name: 'AK-47',
                marketable: 1,
                tradable: 1,
                tags: [],
                descriptions: [],
            },
        ],
    };
    const items = parseSteamInventory(payload, { appId: '730' });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, '730_C1_I1');
});

const { fetchSteamInventory } = require('../src/services/steamIntegration');

function withFetchMock(mock, fn) {
    const previous = global.fetch;
    global.fetch = mock;
    return Promise.resolve()
        .then(fn)
        .finally(() => { global.fetch = previous; });
}

test('fetchSteamInventory uses contextId 2 for game appIds', async () => {
    const calls = [];
    await withFetchMock(async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ success: true, assets: [], descriptions: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }, async () => {
        await fetchSteamInventory('76561198000000001', '730');
    });
    assert.match(calls[0], /\/inventory\/76561198000000001\/730\/2\?/);
});

test('fetchSteamInventory uses contextId 6 for the Steam Community appId 753', async () => {
    const calls = [];
    await withFetchMock(async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ success: true, assets: [], descriptions: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }, async () => {
        await fetchSteamInventory('76561198000000001', '753');
    });
    assert.match(calls[0], /\/inventory\/76561198000000001\/753\/6\?/);
});

test('fetchSteamInventory throws STEAM_INVENTORY_PRIVATE on 403', async () => {
    await withFetchMock(async () => new Response('null', {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
    }), async () => {
        await assert.rejects(
            fetchSteamInventory('76561198000000001', '730'),
            (error) => error.code === 'STEAM_INVENTORY_PRIVATE',
        );
    });
});

test('fetchSteamInventory throws STEAM_INVENTORY_PRIVATE on success:false payload', async () => {
    await withFetchMock(async () => new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    }), async () => {
        await assert.rejects(
            fetchSteamInventory('76561198000000001', '730'),
            (error) => error.code === 'STEAM_INVENTORY_PRIVATE',
        );
    });
});

test('fetchSteamInventory throws STEAM_RATE_LIMITED on 429', async () => {
    await withFetchMock(async () => new Response('Too many requests', { status: 429 }), async () => {
        await assert.rejects(
            fetchSteamInventory('76561198000000001', '730'),
            (error) => error.code === 'STEAM_RATE_LIMITED',
        );
    });
});

test('fetchSteamInventory returns parsed items on success', async () => {
    await withFetchMock(async () => new Response(JSON.stringify({
        success: true,
        assets: [
            { appid: 730, contextid: '2', assetid: '1', classid: 'C', instanceid: 'I' },
        ],
        descriptions: [
            { appid: 730, classid: 'C', instanceid: 'I', market_hash_name: 'X', marketable: 1, tradable: 1 },
        ],
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    }), async () => {
        const items = await fetchSteamInventory('76561198000000001', '730');
        assert.equal(items.length, 1);
        assert.equal(items[0].marketHashName, 'X');
    });
});

const { getSteamInventory } = require('../src/services/steamIntegration');

function makeLinkedSteamUser() {
    return {
        _id: 'user-1',
        linkedAccounts: {
            steam: {
                status: 'connected',
                profile: { steamId: '76561198000000001' },
                scopes: ['openid'],
            },
        },
    };
}

test('getSteamInventory throws LINKED_ACCOUNT_REQUIRED if Steam is not linked', async () => {
    await assert.rejects(
        getSteamInventory({ _id: 'user-1', linkedAccounts: {} }, { appId: '730' }),
        (error) => error.code === 'LINKED_ACCOUNT_REQUIRED',
    );
});

test('getSteamInventory caches results for 1 h', async () => {
    let callCount = 0;
    await withFetchMock(async () => {
        callCount += 1;
        return new Response(JSON.stringify({
            success: true,
            assets: [{ appid: 730, classid: 'C', instanceid: 'I', assetid: '1' }],
            descriptions: [{ classid: 'C', instanceid: 'I', market_hash_name: 'X', marketable: 1, tradable: 1 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }, async () => {
        const user = makeLinkedSteamUser();
        const a = await getSteamInventory(user, { appId: '730' });
        const b = await getSteamInventory(user, { appId: '730' });
        assert.equal(callCount, 1);
        assert.equal(a.cacheStatus, 'miss');
        assert.equal(b.cacheStatus, 'hit');
        assert.equal(a.items.length, 1);
        assert.equal(b.items.length, 1);
    });
});

test('getSteamInventory force=true bypasses the cache', async () => {
    let callCount = 0;
    await withFetchMock(async () => {
        callCount += 1;
        return new Response(JSON.stringify({
            success: true,
            assets: [{ appid: 730, classid: 'C', instanceid: 'I', assetid: '1' }],
            descriptions: [{ classid: 'C', instanceid: 'I', market_hash_name: 'X', marketable: 1, tradable: 1 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }, async () => {
        const user = {
            _id: 'user-1',
            linkedAccounts: {
                steam: {
                    status: 'connected',
                    profile: { steamId: '76561198000000099' },
                    scopes: ['openid'],
                },
            },
        };
        await getSteamInventory(user, { appId: '730' });
        const result = await getSteamInventory(user, { appId: '730', force: true });
        assert.equal(callCount, 2);
        assert.equal(result.cacheStatus, 'forced');
    });
});
