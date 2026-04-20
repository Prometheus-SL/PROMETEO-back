const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../http/asyncHandler');
const { ok } = require('../http/responses');
const { createHttpError } = require('../http/errors');
const LoginHistory = require('../models/LoginHistory');
const {
    assertValidProvider,
    buildOAuthCallbackUrl,
    buildOAuthLoginUrl,
    completeOAuthLogin,
    verifyOAuthLoginState,
} = require('../services/oauthLogin');

const router = express.Router();

const oauthLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 10000000 : 20,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many OAuth login attempts. Try again later.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

function getRequestMetadata(req) {
    return {
        userAgent: req.get('User-Agent') || null,
        ip: req.ip || req.connection?.remoteAddress || null,
    };
}

function serializeUser(user) {
    return {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
        name: user.name,
        surname: user.surname,
        birthday: user.birthday,
    };
}

function serializeTokens(tokens) {
    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sessionId: tokens.sessionId,
        expiresIn: null,
    };
}

// POST /auth/oauth/:provider/authorize — Public, returns { authorizeUrl }
router.post('/:provider/authorize', oauthLoginLimiter, asyncHandler(async (req, res) => {
    const { provider } = req.params;
    assertValidProvider(provider);

    const authorizeUrl = buildOAuthLoginUrl(provider, req);
    return ok(res, { authorizeUrl });
}));

// Reusable handler for OAuth login callbacks (also called from linked-accounts callback)
async function handleOAuthLoginCallback(req, res, { provider, code, state, oauthError }) {
    let statePayload;
    try {
        assertValidProvider(provider);
        statePayload = verifyOAuthLoginState(state);
    } catch (err) {
        const fallbackOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
        return res.redirect(
            buildOAuthCallbackUrl({
                origin: fallbackOrigin,
                status: 'error',
                error: err.message || 'Invalid OAuth state.',
            })
        );
    }

    const returnOrigin = statePayload.returnOrigin;

    if (oauthError) {
        return res.redirect(
            buildOAuthCallbackUrl({
                origin: returnOrigin,
                status: 'error',
                error: `OAuth provider returned an error: ${oauthError}`,
            })
        );
    }

    if (!code) {
        return res.redirect(
            buildOAuthCallbackUrl({
                origin: returnOrigin,
                status: 'error',
                error: 'No authorization code received from the provider.',
            })
        );
    }

    try {
        const reqMeta = getRequestMetadata(req);
        const result = await completeOAuthLogin(provider, code, statePayload, reqMeta);

        LoginHistory.create({
            userId: result.user._id,
            username: result.user.username,
            method: `oauth:${provider}`,
            success: true,
            ip: reqMeta.ip,
            userAgent: reqMeta.userAgent,
            sessionId: result.tokens.sessionId,
        }).catch(() => { });

        return res.redirect(
            buildOAuthCallbackUrl({
                origin: returnOrigin,
                status: 'success',
                tokens: serializeTokens(result.tokens),
            })
        );
    } catch (err) {
        LoginHistory.create({
            userId: null,
            username: null,
            method: `oauth:${provider}`,
            success: false,
            ip: getRequestMetadata(req).ip,
            userAgent: getRequestMetadata(req).userAgent,
            failureReason: err.message || 'OAuth login failed',
        }).catch(() => { });

        return res.redirect(
            buildOAuthCallbackUrl({
                origin: returnOrigin,
                status: 'error',
                error: err.message || 'OAuth login failed.',
            })
        );
    }
}

// GET /auth/oauth/:provider/callback — Public, redirects to frontend
router.get('/:provider/callback', asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const { code, state, error: oauthError } = req.query;
    return handleOAuthLoginCallback(req, res, { provider, code, state, oauthError });
}));

module.exports = router;
module.exports.handleOAuthLoginCallback = handleOAuthLoginCallback;
