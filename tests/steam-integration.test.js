const assert = require('node:assert/strict');
const test = require('node:test');

function withSteamEnv(fn) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        CORS_ORIGINS: process.env.CORS_ORIGINS,
        STEAM_REDIRECT_URI: process.env.STEAM_REDIRECT_URI,
        STEAM_WEB_API_KEY: process.env.STEAM_WEB_API_KEY,
    };

    process.env.JWT_SECRET = 'test-secret';
    process.env.CORS_ORIGINS = 'http://localhost:5173';
    process.env.STEAM_REDIRECT_URI = 'http://localhost:3000/api/v1/account/linked-accounts/steam/callback';
    process.env.STEAM_WEB_API_KEY = 'steam-key';

    return Promise.resolve()
        .then(fn)
        .finally(() => {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        });
}

test('buildSteamAuthorizeUrl creates a Steam OpenID link with stateful return_to', async () => {
    await withSteamEnv(async () => {
        const { buildSteamAuthorizeUrl } = require('../src/services/steamIntegration');

        const authorizeUrl = buildSteamAuthorizeUrl(
            { _id: 'user-1' },
            'session-1',
            {
                get: (name) => (name.toLowerCase() === 'origin' ? 'http://localhost:5173' : undefined),
                body: {},
            }
        );
        const url = new URL(authorizeUrl);
        const returnTo = new URL(url.searchParams.get('openid.return_to'));

        assert.equal(url.origin, 'https://steamcommunity.com');
        assert.equal(url.pathname, '/openid/login');
        assert.equal(url.searchParams.get('openid.mode'), 'checkid_setup');
        assert.equal(url.searchParams.get('openid.identity'), 'http://specs.openid.net/auth/2.0/identifier_select');
        assert.equal(url.searchParams.get('openid.claimed_id'), 'http://specs.openid.net/auth/2.0/identifier_select');
        assert.equal(returnTo.origin, 'http://localhost:3000');
        assert.equal(returnTo.pathname, '/api/v1/account/linked-accounts/steam/callback');
        assert.ok(returnTo.searchParams.get('state'));
    });
});

test('completeSteamLink verifies OpenID and stores the linked Steam profile', async () => {
    await withSteamEnv(async () => {
        const calls = [];
        const previousFetch = global.fetch;
        global.fetch = async (url, options = {}) => {
            calls.push({ url: String(url), options });
            if (String(url) === 'https://steamcommunity.com/openid/login') {
                return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' },
                });
            }

            return new Response(JSON.stringify({
                response: {
                    players: [
                        {
                            steamid: '76561198000000001',
                            personaname: 'Prometeo Player',
                            avatarfull: 'https://steamcdn/avatar.jpg',
                            profileurl: 'https://steamcommunity.com/id/prometeo',
                            communityvisibilitystate: 3,
                        },
                    ],
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        try {
            const { completeSteamLink } = require('../src/services/steamIntegration');
            let saveCalled = false;
            const user = {
                _id: 'user-1',
                linkedAccounts: {},
                save: async () => {
                    saveCalled = true;
                },
            };

            const status = await completeSteamLink(user, {
                'openid.mode': 'id_res',
                'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000001',
                'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000001',
                'openid.return_to': 'http://localhost:3000/api/v1/account/linked-accounts/steam/callback?state=abc',
                'openid.response_nonce': 'nonce',
                'openid.assoc_handle': 'assoc',
                'openid.signed': 'signed',
                'openid.sig': 'sig',
            });

            assert.equal(saveCalled, true);
            assert.equal(status.status, 'connected');
            assert.equal(status.profile.steamId, '76561198000000001');
            assert.equal(status.profile.personaName, 'Prometeo Player');
            assert.equal(user.linkedAccounts.steam.profile.profileUrl, 'https://steamcommunity.com/id/prometeo');
            assert.equal(calls[0].options.method, 'POST');
            assert.match(String(calls[1].url), /GetPlayerSummaries\/v2/);
        } finally {
            global.fetch = previousFetch;
        }
    });
});

test('getSteamFriendsPresence returns online friends and their current game', async () => {
    await withSteamEnv(async () => {
        const previousFetch = global.fetch;
        global.fetch = async (url) => {
            const href = String(url);
            if (href.includes('/GetFriendList/')) {
                return new Response(JSON.stringify({
                    friendslist: {
                        friends: [
                            { steamid: '76561198000000002', relationship: 'friend', friend_since: 1700000000 },
                            { steamid: '76561198000000003', relationship: 'friend', friend_since: 1700001000 },
                        ],
                    },
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({
                response: {
                    players: [
                        {
                            steamid: '76561198000000002',
                            personaname: 'Playing Friend',
                            personastate: 1,
                            gameid: '730',
                            gameextrainfo: 'Counter-Strike 2',
                            avatarmedium: 'https://steamcdn/friend-1.jpg',
                            profileurl: 'https://steamcommunity.com/profiles/76561198000000002',
                        },
                        {
                            steamid: '76561198000000003',
                            personaname: 'Offline Friend',
                            personastate: 0,
                        },
                    ],
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        try {
            const { getSteamFriendsPresence } = require('../src/services/steamIntegration');
            const result = await getSteamFriendsPresence({
                _id: 'user-1',
                linkedAccounts: {
                    steam: {
                        status: 'connected',
                        profile: { steamId: '76561198000000001' },
                    },
                },
            }, {
                limit: 5,
                maxFriendsToInspect: 5,
            });

            assert.equal(result.onlineCount, 1);
            assert.equal(result.playingCount, 1);
            assert.equal(result.friends[0].steamId, '76561198000000002');
            assert.equal(result.friends[0].game.name, 'Counter-Strike 2');
            assert.equal(result.friends[1].personaStateLabel, 'offline');
        } finally {
            global.fetch = previousFetch;
        }
    });
});

test('getSteamDeals maps Steam Store specials into widget-safe deals', async () => {
    const previousFetch = global.fetch;
    global.fetch = async (url) => {
        assert.match(String(url), /featuredcategories/);
        return new Response(JSON.stringify({
            specials: {
                items: [
                    {
                        id: 1091500,
                        name: 'Cyberpunk 2077',
                        discount_percent: 65,
                        original_price: 5999,
                        final_price: 2099,
                        currency: 'EUR',
                        header_image: 'https://cdn/header.jpg',
                        large_capsule_image: 'https://cdn/capsule.jpg',
                        windows_available: true,
                        mac_available: true,
                        linux_available: false,
                        discount_expiration: 1777827600,
                    },
                ],
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const { getSteamDeals } = require('../src/services/steamIntegration');
        const result = await getSteamDeals({ country: 'ES', language: 'spanish', limit: 3 });

        assert.equal(result.country, 'ES');
        assert.equal(result.deals.length, 1);
        assert.equal(result.deals[0].appId, 1091500);
        assert.equal(result.deals[0].discountPercent, 65);
        assert.equal(result.deals[0].finalPrice, 2099);
        assert.equal(result.deals[0].url, 'https://store.steampowered.com/app/1091500');
        assert.deepEqual(result.deals[0].platforms, {
            windows: true,
            mac: true,
            linux: false,
        });
    } finally {
        global.fetch = previousFetch;
    }
});
