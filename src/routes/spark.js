const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { buildErrorPayload, ok } = require('../http/responses');
const groqClient = require('../services/spark/groqClient');
const {
    handleSparkMessage,
    listSparkTools,
    resumeSparkRun,
} = require('../services/spark/orchestrator');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
});

function readPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function createSparkRateLimiter({ maxEnv, windowEnv, fallbackMax, fallbackWindowMs, message }) {
    return rateLimit({
        windowMs: readPositiveInt(process.env[windowEnv], fallbackWindowMs),
        max: readPositiveInt(process.env[maxEnv], fallbackMax),
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator(req) {
            if (req.user?._id) {
                return `spark:${req.user._id}`;
            }

            return rateLimit.ipKeyGenerator(req.ip || 'spark-anon');
        },
        handler(req, res) {
            const error = createHttpError(429, 'SPARK_RATE_LIMITED', message);
            return res.status(error.status).json(buildErrorPayload(error, {
                meta: {
                    timestamp: new Date().toISOString(),
                    path: req.originalUrl,
                    method: req.method,
                },
            }));
        },
    });
}

const messageLimiter = createSparkRateLimiter({
    maxEnv: 'SPARK_MESSAGE_RATE_LIMIT_MAX',
    windowEnv: 'SPARK_MESSAGE_RATE_LIMIT_WINDOW_MS',
    fallbackMax: 30,
    fallbackWindowMs: 60_000,
    message: 'Has enviado demasiados mensajes a Spark. Espera un momento.',
});

const resumeLimiter = createSparkRateLimiter({
    maxEnv: 'SPARK_CLIENT_RESULTS_RATE_LIMIT_MAX',
    windowEnv: 'SPARK_CLIENT_RESULTS_RATE_LIMIT_WINDOW_MS',
    fallbackMax: 60,
    fallbackWindowMs: 60_000,
    message: 'Spark esta recibiendo demasiadas acciones locales. Espera un momento.',
});

const transcribeLimiter = createSparkRateLimiter({
    maxEnv: 'SPARK_TRANSCRIBE_RATE_LIMIT_MAX',
    windowEnv: 'SPARK_TRANSCRIBE_RATE_LIMIT_WINDOW_MS',
    fallbackMax: 12,
    fallbackWindowMs: 60_000,
    message: 'Has enviado demasiado audio a Spark. Espera un momento.',
});

router.get('/tools', authenticateToken, asyncHandler(async (req, res) => {
    return ok(res, await listSparkTools(req.user));
}));

router.post('/message', authenticateToken, messageLimiter, asyncHandler(async (req, res) => {
    const result = await handleSparkMessage({
        user: req.user,
        message: req.body?.message,
    });

    return ok(res, result);
}));

router.post('/runs/:runId/client-results', authenticateToken, resumeLimiter, asyncHandler(async (req, res) => {
    const results = req.body?.results;
    if (!Array.isArray(results)) {
        throw createHttpError(400, 'SPARK_CLIENT_RESULTS_REQUIRED', 'results must be an array');
    }

    const result = await resumeSparkRun({
        user: req.user,
        runId: req.params.runId,
        results,
    });

    return ok(res, result);
}));

router.post('/transcribe', authenticateToken, transcribeLimiter, upload.single('audio'), asyncHandler(async (req, res) => {
    if (!req.file) {
        throw createHttpError(400, 'SPARK_AUDIO_REQUIRED', 'audio file is required');
    }

    const text = await groqClient.transcribeAudio(req.file);
    return ok(res, { text });
}));

module.exports = router;
