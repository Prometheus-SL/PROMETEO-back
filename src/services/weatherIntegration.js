const { createHttpError } = require('../http/errors');

const OPENWEATHER_CURRENT_URL = 'https://api.openweathermap.org/data/2.5/weather';
const SUPPORTED_UNITS = new Set(['metric', 'imperial']);
const SUPPORTED_LANGUAGES = new Set(['es', 'en', 'fr', 'de']);

function assertWeatherConfigured() {
    const apiKey = String(process.env.OPENWEATHER_API_KEY || '').trim();

    if (!apiKey) {
        throw createHttpError(
            500,
            'WEATHER_NOT_CONFIGURED',
            'Weather integration is not configured in the backend.'
        );
    }

    return apiKey;
}

function normalizeUnits(units) {
    const normalized = String(units || 'metric').trim().toLowerCase();
    return SUPPORTED_UNITS.has(normalized) ? normalized : 'metric';
}

function normalizeLanguage(language) {
    const normalized = String(language || 'es').trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : 'es';
}

async function parseProviderResponse(response) {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        try {
            return await response.json();
        } catch (_error) {
            return null;
        }
    }

    try {
        return await response.text();
    } catch (_error) {
        return null;
    }
}

function getProviderErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    if (payload && typeof payload === 'object') {
        if (typeof payload.message === 'string' && payload.message.trim()) {
            return payload.message.trim();
        }
        if (typeof payload.error === 'string' && payload.error.trim()) {
            return payload.error.trim();
        }
    }

    return fallback;
}

function createWeatherProviderError(response, payload) {
    if (response.status === 404) {
        return createHttpError(
            404,
            'WEATHER_CITY_NOT_FOUND',
            'Could not find weather for the requested city.',
            { details: payload }
        );
    }

    if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return createHttpError(
            429,
            'WEATHER_RATE_LIMITED',
            'Weather provider rate limit reached. Try again soon.',
            {
                details: payload,
                headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
            }
        );
    }

    if (response.status === 401 || response.status === 403) {
        return createHttpError(
            500,
            'WEATHER_PROVIDER_AUTH_FAILED',
            'Weather integration credentials are invalid in the backend.',
            { details: payload }
        );
    }

    return createHttpError(
        502,
        'WEATHER_PROVIDER_ERROR',
        getProviderErrorMessage(payload, `Weather provider returned error ${response.status}.`),
        { details: payload }
    );
}

function normalizeCurrentWeatherPayload(payload, fallbackCity) {
    if (!payload || typeof payload !== 'object') {
        throw createHttpError(
            502,
            'WEATHER_PROVIDER_PAYLOAD_INVALID',
            'Weather provider returned an invalid payload.'
        );
    }

    const weatherArray = Array.isArray(payload.weather) ? payload.weather : [];
    const main = payload.main && typeof payload.main === 'object' ? payload.main : {};
    const wind = payload.wind && typeof payload.wind === 'object' ? payload.wind : {};

    return {
        weather: weatherArray.map((item) => ({
            id: Number(item?.id) || 0,
            main: String(item?.main || ''),
            description: String(item?.description || ''),
            icon: String(item?.icon || ''),
        })),
        main: {
            temp: Number(main.temp) || 0,
            feels_like: main.feels_like !== undefined ? Number(main.feels_like) : undefined,
            humidity: main.humidity !== undefined ? Number(main.humidity) : undefined,
        },
        wind: {
            speed: wind.speed !== undefined ? Number(wind.speed) : undefined,
        },
        name: String(payload.name || fallbackCity || ''),
    };
}

async function getCurrentWeather({ city, units = 'metric', language = 'es' }) {
    const normalizedCity = String(city || '').trim();
    if (!normalizedCity) {
        throw createHttpError(400, 'WEATHER_CITY_REQUIRED', 'city is required to load weather.');
    }

    const apiKey = assertWeatherConfigured();

    const query = new URLSearchParams({
        q: normalizedCity,
        units: normalizeUnits(units),
        lang: normalizeLanguage(language),
        appid: apiKey,
    });

    const response = await fetch(`${OPENWEATHER_CURRENT_URL}?${query.toString()}`);
    const payload = await parseProviderResponse(response);

    if (!response.ok) {
        throw createWeatherProviderError(response, payload);
    }

    return normalizeCurrentWeatherPayload(payload, normalizedCity);
}

module.exports = {
    getCurrentWeather,
};
