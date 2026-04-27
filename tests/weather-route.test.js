const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createRouteApp } = require('./helpers/routeApp');

function createWeatherRouteApp(overrides = {}) {
    const state = {
        calls: [],
        ...overrides.state,
    };

    const weatherService = {
        getCurrentWeather: async ({ city, units, language }) => {
            state.calls.push({ city, units, language });
            return {
                weather: [
                    { id: 800, main: 'Clear', description: 'clear sky', icon: '01d' },
                ],
                main: { temp: 23, feels_like: 22, humidity: 45 },
                wind: { speed: 2.7 },
                name: city,
            };
        },
        ...overrides.weatherService,
    };

    const { app, cleanup } = createRouteApp({
        routePath: 'src/routes/weather.js',
        mountPath: '/api/v1/integrations/weather',
        mocks: {
            'src/middleware/auth.js': {
                authenticateToken(req, _res, next) {
                    req.user = { _id: 'user-1' };
                    next();
                },
            },
            'src/services/weatherIntegration.js': weatherService,
        },
    });

    return { app, cleanup, state };
}

test('GET /api/v1/integrations/weather/current proxies weather using backend credentials', async (t) => {
    const { app, cleanup, state } = createWeatherRouteApp();
    t.after(cleanup);

    const response = await request(app)
        .get('/api/v1/integrations/weather/current')
        .query({
            city: 'Madrid',
            units: 'metric',
            lang: 'es',
        });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.name, 'Madrid');
    assert.deepEqual(state.calls, [
        {
            city: 'Madrid',
            units: 'metric',
            language: 'es',
        },
    ]);
});

test('GET /api/v1/integrations/weather/current rejects missing city', async (t) => {
    const { app, cleanup } = createWeatherRouteApp();
    t.after(cleanup);

    const response = await request(app).get('/api/v1/integrations/weather/current');

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'WEATHER_CITY_REQUIRED');
});
