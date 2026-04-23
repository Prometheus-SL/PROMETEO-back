const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const multer = require('multer');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const { processAvatarImage, AVATAR_MAX_BYTES } = require('../services/avatarService');
const {
    buildLinkedAccountCallbackUrl,
    getDefaultClientOrigin,
    peekOAuthStateType,
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
const {
    buildGoogleAuthorizeUrl,
    completeGoogleLink,
    disconnectGoogleAccount,
    getGoogleStatus,
} = require('../services/googleIntegration');
const {
    buildGithubAuthorizeUrl,
    completeGithubLink,
    disconnectGithubAccount,
    getGithubStatus,
} = require('../services/githubIntegration');
const {
    getCreatorStatus,
} = require('../services/creatorIntegration');
const { handleOAuthLoginCallback } = require('./oauthLogin');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
});

function getAvatarsDir() {
    if (process.env.AVATARS_DIR_OVERRIDE) {
        fs.mkdirSync(process.env.AVATARS_DIR_OVERRIDE, { recursive: true });
        return process.env.AVATARS_DIR_OVERRIDE;
    }
    const dir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function avatarUrlFor(userId) {
    return `/uploads/avatars/${userId}.webp`;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeOptionalText(value, maxLength, fieldName) {
    const text = normalizeText(value);
    if (text.length > maxLength) {
        throw createHttpError(400, `${fieldName.toUpperCase()}_TOO_LONG`, `${fieldName} cannot exceed ${maxLength} characters.`);
    }
    return text || undefined;
}

function normalizeUsername(value) {
    const username = normalizeText(value);
    if (username.length < 3 || username.length > 30) {
        throw createHttpError(400, 'USERNAME_INVALID', 'Username must be between 3 and 30 characters.');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        throw createHttpError(400, 'USERNAME_INVALID', 'Username can only contain letters, numbers, dots, hyphens, and underscores.');
    }
    return username;
}

function serializeEditableProfile(user) {
    return {
        user: serializeUserSummary(user),
    };
}

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
    google: {
        id: 'google',
        name: 'Google Workspace',
        description: 'Calendar agenda, Tasks planning, Gmail summaries, and focus hints.',
        kind: 'oauth',
        connectPath: '/api/v1/account/linked-accounts/google/connect',
        disconnectPath: '/api/v1/account/linked-accounts/google',
        buildAuthorizeUrl: buildGoogleAuthorizeUrl,
        completeLink: completeGoogleLink,
        disconnectAccount: disconnectGoogleAccount,
        getStatus: getGoogleStatus,
    },
    github: {
        id: 'github',
        name: 'GitHub',
        description: 'Pull request pulse, notifications, and engineering activity.',
        kind: 'oauth',
        connectPath: '/api/v1/account/linked-accounts/github/connect',
        disconnectPath: '/api/v1/account/linked-accounts/github',
        buildAuthorizeUrl: buildGithubAuthorizeUrl,
        completeLink: completeGithubLink,
        disconnectAccount: disconnectGithubAccount,
        getStatus: getGithubStatus,
    },
    creator: {
        id: 'creator',
        name: 'Creator Status',
        description: 'Live state across creator channels like YouTube and Twitch.',
        kind: 'internal',
        connectPath: '/api/v1/account/linked-accounts/creator/connect',
        disconnectPath: '/api/v1/account/linked-accounts/creator',
        getStatus: getCreatorStatus,
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

router.patch('/profile', authenticateToken, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    const username = normalizeUsername(req.body?.username ?? user.username);
    if (username !== user.username) {
        const existing = await User.findOne({ username, _id: { $ne: user._id } });
        if (existing) {
            throw createHttpError(409, 'USER_ALREADY_EXISTS', 'That username is already in use.');
        }
        user.username = username;
    }

    user.name = normalizeOptionalText(req.body?.name, 50, 'name');
    user.surname = normalizeOptionalText(req.body?.surname, 50, 'surname');

    await user.save();
    return ok(res, serializeEditableProfile(user), { message: 'Profile updated.' });
}));

router.post('/password', authenticateToken, asyncHandler(async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
        throw createHttpError(400, 'PASSWORD_FIELDS_REQUIRED', 'Current password and new password are required.');
    }
    if (newPassword.length < 12) {
        throw createHttpError(400, 'PASSWORD_TOO_SHORT', 'Password must be at least 12 characters long.');
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    const matches = await user.matchPassword(currentPassword);
    if (!matches) {
        throw createHttpError(400, 'CURRENT_PASSWORD_INVALID', 'Current password is invalid.');
    }

    user.password = newPassword;
    await user.save();

    return ok(res, null, { message: 'Password updated.' });
}));

router.post(
    '/avatar',
    authenticateToken,
    (req, res, next) => {
        upload.single('file')(req, res, (err) => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') {
                return next(createHttpError(400, 'AVATAR_TOO_LARGE', 'The image must be 5 MB or less.'));
            }
            return next(createHttpError(400, 'AVATAR_FILE_REQUIRED', 'The uploaded file could not be read.'));
        });
    },
    asyncHandler(async (req, res) => {
        if (!req.file || !req.file.buffer) {
            throw createHttpError(400, 'AVATAR_FILE_REQUIRED', 'No image file was received.');
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            throw createHttpError(404, 'USER_NOT_FOUND', 'User not found.');
        }

        const { buffer } = await processAvatarImage(req.file.buffer);
        const avatarsDir = getAvatarsDir();
        const finalPath = path.join(avatarsDir, `${user._id}.webp`);
        const tempPath = `${finalPath}.tmp`;

        await fsPromises.writeFile(tempPath, buffer);
        await fsPromises.rename(tempPath, finalPath);

        user.avatarUrl = avatarUrlFor(user._id);
        user.avatarUpdatedAt = new Date();
        await user.save();

        return ok(res, serializeEditableProfile(user), { message: 'Profile photo updated.' });
    }),
);

router.delete('/avatar', authenticateToken, asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    const avatarsDir = getAvatarsDir();
    const filePath = path.join(avatarsDir, `${user._id}.webp`);
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    user.avatarUrl = null;
    user.avatarUpdatedAt = null;
    await user.save();

    return ok(res, serializeEditableProfile(user), { message: 'Profile photo removed.' });
}));

router.post('/linked-accounts/:provider/connect', authenticateToken, asyncHandler(async (req, res) => {
    const provider = getProviderDefinition(req.params.provider);
    if (typeof provider.buildAuthorizeUrl !== 'function') {
        throw createHttpError(405, 'LINKED_ACCOUNT_CONNECT_UNSUPPORTED', `${provider.name} cannot be linked from this route.`);
    }
    const sessionId = requireSessionId(req.auth?.sessionId, provider.name);
    const authorizeUrl = provider.buildAuthorizeUrl(req.user, sessionId, req);
    return ok(res, { authorizeUrl });
}));

router.delete('/linked-accounts/:provider', authenticateToken, asyncHandler(async (req, res) => {
    const provider = getProviderDefinition(req.params.provider);
    if (typeof provider.disconnectAccount !== 'function') {
        throw createHttpError(405, 'LINKED_ACCOUNT_DISCONNECT_UNSUPPORTED', `${provider.name} cannot be disconnected from this route.`);
    }
    const account = await provider.disconnectAccount(req.user);
    return ok(res, { [provider.id]: account }, { message: `${provider.name} account disconnected.` });
}));

router.get('/linked-accounts/:provider/callback', async (req, res) => {
    const providerId = String(req.params.provider || '').trim().toLowerCase();

    // Delegate to OAuth login handler when the state JWT is an oauth-login type
    const stateType = peekOAuthStateType(req.query.state);
    if (stateType === 'oauth-login') {
        return handleOAuthLoginCallback(req, res, {
            provider: providerId,
            code: req.query.code,
            state: req.query.state,
            oauthError: req.query.error,
        });
    }

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
        if (typeof definition.completeLink !== 'function') {
            throw createHttpError(405, 'LINKED_ACCOUNT_CALLBACK_UNSUPPORTED', `${definition.name} does not support OAuth callbacks.`);
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
