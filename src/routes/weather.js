const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { getCurrentWeather } = require('../services/weatherIntegration');

const router = express.Router();

router.get('/current', authenticateToken, asyncHandler(async (req, res) => {
    const city = String(req.query.city || '').trim();
    if (!city) {
        throw createHttpError(400, 'WEATHER_CITY_REQUIRED', 'city is required to load weather.');
    }

    const units = String(req.query.units || '').trim();
    const language = String(req.query.lang || req.query.language || '').trim();

    const weather = await getCurrentWeather({
        city,
        units,
        language,
    });

    return ok(res, weather);
}));

module.exports = router;
