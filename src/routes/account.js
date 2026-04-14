const express = require('express');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
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
    getSpotifyStatus,
} = require('../services/spotifyIntegration');
const {
    buildDiscordAuthorizeUrl,
    completeDiscordLink,
    disconnectDiscordAccount,
    getDiscordStatus,
} = require('../services/discordIntegration');

const router = express.Router();

const LINKED_ACCOUNT_PROVIDERS = {
    spotify: {
        id: 'spotify',
        name: 'Spotify',
        description: 'Playback controls, queue access, and reusable account auth.',
        kind: 'oauth',
        connectPath: '/api/v1/account/linked-accounts/spotify/connect',
        disconnectPath: '/api/v1/account/linked-accounts/spotify',
        buildAuthorizeUrl: buildSpotifyAuthorizeUrl,
        completeLink: completeSpotifyLink,
        disconnectAccount: disconnectSpotifyAccount,
        getStatus: getSpotifyStatus,
    },
    discord: {
        id: 'discord',
        name: 'Discord',
        description: 'Community presence, guild widgets, and reusable identity data.',
        kind: 'oauth',
        connectPath: '/api/v1/account/linked-accounts/discord/connect',
        disconnectPath: '/api/v1/account/linked-accounts/discord',
        buildAuthorizeUrl: buildDiscordAuthorizeUrl,
        completeLink: completeDiscordLink,
        disconnectAccount: disconnectDiscordAccount,
        getStatus: getDiscordStatus,
    },
};

function requireSessionId(sessionId, provider) {
    if (sessionId) {
        return sessionId;
    }

    throw createHttpError(401, 'SESSION_REQUIRED', `The current session cannot link ${provider}.`);
}

function getProviderDefinition(providerId) {
    const provider = LINKED_ACCOUNT_PROVIDERS[String(providerId || '').trim().toLowerCase()];
    if (!provider) {
        throw createHttpError(404, 'LINKED_ACCOUNT_PROVIDER_NOT_FOUND', 'The linked-account provider was not found.');
    }

    return provider;
}

async function listProviderSummaries(user) {
    const legacyAccounts = serializeLinkedAccounts(user.linkedAccounts);
    const providers = [];

    for (const provider of Object.values(LINKED_ACCOUNT_PROVIDERS)) {
        const rawAccount = user?.linkedAccounts?.[provider.id] || {};
        const fallback = legacyAccounts[provider.id] || {
            status: 'disconnected',
            connectedAt: null,
            tokenExpiresAt: null,
            scopes: [],
            lastError: null,
        };

        let available = true;
        let liveStatus = fallback;

        if (typeof provider.getStatus === 'function') {
            try {
                liveStatus = await provider.getStatus(user);
            } catch (error) {
                available = false;
                liveStatus = {
                    ...fallback,
                    lastError: fallback.lastError || error.message || null,
                };
            }
        }

        providers.push({
            id: provider.id,
            name: provider.name,
            description: provider.description,
            kind: provider.kind,
            status: liveStatus.status || 'disconnected',
            profile: liveStatus.profile || rawAccount.profile || null,
            connectedAt: liveStatus.connectedAt || null,
            tokenExpiresAt: liveStatus.tokenExpiresAt || rawAccount.tokenExpiresAt || null,
            scopes: Array.isArray(liveStatus.scopes) ? liveStatus.scopes : [],
            lastError: liveStatus.lastError || null,
            available,
            connectSupported: available && typeof provider.buildAuthorizeUrl === 'function',
            disconnectSupported: typeof provider.disconnectAccount === 'function',
            connectPath: provider.connectPath,
            disconnectPath: provider.disconnectPath,
        });
    }

    return providers;
}

async function buildLinkedAccountPayload(user) {
    return {
        user: serializeUserSummary(user),
        linkedAccounts: serializeLinkedAccounts(user.linkedAccounts),
        providers: await listProviderSummaries(user),
    };
}

router.get('/', authenticateToken, asyncHandler(async (req, res) => {
    return ok(res, await buildLinkedAccountPayload(req.user));
}));

router.get('/providers', authenticateToken, asyncHandler(async (req, res) => {
    return ok(res, {
        providers: await listProviderSummaries(req.user),
    });
}));

router.post('/linked-accounts/:provider/connect', authenticateToken, asyncHandler(async (req, res) => {
    const provider = getProviderDefinition(req.params.provider);
    const sessionId = requireSessionId(req.auth?.sessionId, provider.name);
    const authorizeUrl = provider.buildAuthorizeUrl(req.user, sessionId, req);
    return ok(res, { authorizeUrl });
}));

router.delete('/linked-accounts/:provider', authenticateToken, asyncHandler(async (req, res) => {
    const provider = getProviderDefinition(req.params.provider);
    const account = await provider.disconnectAccount(req.user);
    return ok(res, { [provider.id]: account }, { message: `${provider.name} account disconnected.` });
}));

router.get('/linked-accounts/:provider/callback', async (req, res) => {
    const providerId = String(req.params.provider || '').trim().toLowerCase();
    let callbackOrigin = getDefaultClientOrigin();

    try {
        const definition = getProviderDefinition(providerId);
        const statePayload = verifyLinkedAccountState(req.query.state);
        callbackOrigin = statePayload?.returnOrigin || callbackOrigin;

        if (statePayload?.provider !== providerId) {
            throw createHttpError(400, 'LINKED_ACCOUNT_PROVIDER_INVALID', `The callback provider is invalid for ${definition.name}.`);
        }

        if (req.query.error) {
            throw createHttpError(400, `${providerId.toUpperCase()}_AUTH_DENIED`, `${definition.name} authorization was cancelled.`, {
                details: { error: req.query.error },
            });
        }

        const code = String(req.query.code || '').trim();
        if (!code) {
            throw createHttpError(400, `${providerId.toUpperCase()}_CODE_MISSING`, `${definition.name} did not return an authorization code.`);
        }

        const user = await User.findById(statePayload.userId);
        if (!user || !user.isActive) {
            throw createHttpError(401, 'LINKED_ACCOUNT_SESSION_INVALID', 'The user session is no longer available.');
        }

        if (!user.hasSession(statePayload.sessionId)) {
            throw createHttpError(401, 'LINKED_ACCOUNT_SESSION_INVALID', `The session is no longer active. Sign in again before linking ${definition.name}.`);
        }

        await definition.completeLink(user, code);

        return res.redirect(buildLinkedAccountCallbackUrl({
            origin: callbackOrigin,
            provider: providerId,
            status: 'success',
        }));
    } catch (error) {
        return res.redirect(buildLinkedAccountCallbackUrl({
            origin: callbackOrigin,
            provider: providerId,
            status: 'error',
            error: error.message || 'The provider could not be linked.',
        }));
    }
});

module.exports = router;
