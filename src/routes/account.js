const express = require('express');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const {
    buildLinkedAccountCallbackUrl,
    getDefaultClientOrigin,
    serializeLinkedAccounts,
    serializeUserSummary,
    verifyLinkedAccountState,
} = require('../services/linkedAccounts');
const {
    buildSpotifyAuthorizeUrl,
    completeSpotifyLink,
    disconnectSpotifyAccount,
} = require('../services/spotifyIntegration');
const {
    buildDiscordAuthorizeUrl,
    completeDiscordLink,
    disconnectDiscordAccount,
} = require('../services/discordIntegration');

const router = express.Router();

router.get('/', authenticateToken, async (req, res, next) => {
    try {
        res.json({
            success: true,
            data: {
                user: serializeUserSummary(req.user),
                linkedAccounts: serializeLinkedAccounts(req.user.linkedAccounts),
            },
        });
    } catch (error) {
        next(error);
    }
});

router.post('/linked-accounts/spotify/connect', authenticateToken, async (req, res, next) => {
    try {
        const sessionId = req.auth?.sessionId;
        if (!sessionId) {
            throw Object.assign(new Error('La sesion actual no es valida para vincular Spotify.'), {
                status: 401,
                code: 'SESSION_REQUIRED',
            });
        }

        const authorizeUrl = buildSpotifyAuthorizeUrl(req.user, sessionId, req);
        res.json({
            success: true,
            data: {
                authorizeUrl,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.delete('/linked-accounts/spotify', authenticateToken, async (req, res, next) => {
    try {
        const spotify = await disconnectSpotifyAccount(req.user);
        res.json({
            success: true,
            message: 'Cuenta de Spotify desvinculada.',
            data: {
                spotify,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.get('/linked-accounts/spotify/callback', async (req, res) => {
    let callbackOrigin = getDefaultClientOrigin();

    try {
        const statePayload = verifyLinkedAccountState(req.query.state);
        callbackOrigin = statePayload?.returnOrigin || callbackOrigin;

        if (statePayload?.provider !== 'spotify') {
            throw Object.assign(new Error('El proveedor indicado no es valido para este callback.'), {
                status: 400,
                code: 'LINKED_ACCOUNT_PROVIDER_INVALID',
            });
        }

        if (req.query.error) {
            throw Object.assign(new Error('La autorizacion con Spotify fue cancelada.'), {
                status: 400,
                code: 'SPOTIFY_AUTH_DENIED',
                details: { error: req.query.error },
            });
        }

        const code = String(req.query.code || '').trim();
        if (!code) {
            throw Object.assign(new Error('Spotify no devolvio un codigo de autorizacion.'), {
                status: 400,
                code: 'SPOTIFY_CODE_MISSING',
            });
        }

        const user = await User.findById(statePayload.userId);
        if (!user || !user.isActive) {
            throw Object.assign(new Error('La sesion del usuario ya no esta disponible.'), {
                status: 401,
                code: 'LINKED_ACCOUNT_SESSION_INVALID',
            });
        }

        if (!user.hasSession(statePayload.sessionId)) {
            throw Object.assign(new Error('La sesion ya no esta activa. Inicia sesion otra vez antes de vincular Spotify.'), {
                status: 401,
                code: 'LINKED_ACCOUNT_SESSION_INVALID',
            });
        }

        await completeSpotifyLink(user, code);

        return res.redirect(
            buildLinkedAccountCallbackUrl({
                origin: callbackOrigin,
                provider: 'spotify',
                status: 'success',
            })
        );
    } catch (error) {
        return res.redirect(
            buildLinkedAccountCallbackUrl({
                origin: callbackOrigin,
                provider: 'spotify',
                status: 'error',
                error: error.message || 'No se pudo completar la vinculacion con Spotify.',
            })
        );
    }
});

router.post('/linked-accounts/discord/connect', authenticateToken, async (req, res, next) => {
    try {
        const sessionId = req.auth?.sessionId;
        if (!sessionId) {
            throw Object.assign(new Error('La sesion actual no es valida para vincular Discord.'), {
                status: 401,
                code: 'SESSION_REQUIRED',
            });
        }

        const authorizeUrl = buildDiscordAuthorizeUrl(req.user, sessionId, req);
        res.json({
            success: true,
            data: {
                authorizeUrl,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.delete('/linked-accounts/discord', authenticateToken, async (req, res, next) => {
    try {
        const discord = await disconnectDiscordAccount(req.user);
        res.json({
            success: true,
            message: 'Cuenta de Discord desvinculada.',
            data: {
                discord,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.get('/linked-accounts/discord/callback', async (req, res) => {
    let callbackOrigin = getDefaultClientOrigin();

    try {
        const statePayload = verifyLinkedAccountState(req.query.state);
        callbackOrigin = statePayload?.returnOrigin || callbackOrigin;

        if (statePayload?.provider !== 'discord') {
            throw Object.assign(new Error('El proveedor indicado no es valido para este callback.'), {
                status: 400,
                code: 'LINKED_ACCOUNT_PROVIDER_INVALID',
            });
        }

        if (req.query.error) {
            throw Object.assign(new Error('La autorizacion con Discord fue cancelada.'), {
                status: 400,
                code: 'DISCORD_AUTH_DENIED',
                details: { error: req.query.error },
            });
        }

        const code = String(req.query.code || '').trim();
        if (!code) {
            throw Object.assign(new Error('Discord no devolvio un codigo de autorizacion.'), {
                status: 400,
                code: 'DISCORD_CODE_MISSING',
            });
        }

        const user = await User.findById(statePayload.userId);
        if (!user || !user.isActive) {
            throw Object.assign(new Error('La sesion del usuario ya no esta disponible.'), {
                status: 401,
                code: 'LINKED_ACCOUNT_SESSION_INVALID',
            });
        }

        if (!user.hasSession(statePayload.sessionId)) {
            throw Object.assign(new Error('La sesion ya no esta activa. Inicia sesion otra vez antes de vincular Discord.'), {
                status: 401,
                code: 'LINKED_ACCOUNT_SESSION_INVALID',
            });
        }

        await completeDiscordLink(user, code);

        return res.redirect(
            buildLinkedAccountCallbackUrl({
                origin: callbackOrigin,
                provider: 'discord',
                status: 'success',
            })
        );
    } catch (error) {
        return res.redirect(
            buildLinkedAccountCallbackUrl({
                origin: callbackOrigin,
                provider: 'discord',
                status: 'error',
                error: error.message || 'No se pudo completar la vinculacion con Discord.',
            })
        );
    }
});

module.exports = router;
