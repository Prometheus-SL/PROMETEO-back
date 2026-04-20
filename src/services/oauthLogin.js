const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { generateTokens } = require('../middleware/auth');
const {
    createLinkedAccountError,
    getDefaultClientOrigin,
    resolveReturnOrigin,
} = require('./linkedAccounts');

const {
    GOOGLE_SCOPES,
    assertGoogleConfigured,
    fetchGoogleProfile,
    persistGoogleTokens,
    requestGoogleToken,
} = require('./googleIntegration');

const {
    GITHUB_SCOPES,
    assertGithubConfigured,
    fetchGithubProfile,
    persistGithubTokens,
    requestGithubToken,
} = require('./githubIntegration');

const {
    DISCORD_SCOPES,
    assertDiscordConfigured,
    fetchDiscordProfile,
    persistDiscordTokens,
    requestDiscordToken,
} = require('./discordIntegration');

const VALID_PROVIDERS = ['google', 'github', 'discord'];

const PROVIDER_CONFIG = {
    google: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: GOOGLE_SCOPES,
        assertConfigured: assertGoogleConfigured,
        requestToken: requestGoogleToken,
        fetchProfile: fetchGoogleProfile,
        persistTokens: persistGoogleTokens,
        buildAuthorizeParams(clientId, redirectUri, scopes, state) {
            const url = new URL(this.authorizeUrl);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('redirect_uri', redirectUri);
            url.searchParams.set('scope', scopes.join(' '));
            url.searchParams.set('access_type', 'offline');
            url.searchParams.set('prompt', 'consent');
            url.searchParams.set('include_granted_scopes', 'true');
            url.searchParams.set('state', state);
            return url.toString();
        },
        getProviderId(profile) {
            return profile?.sub || profile?.id || null;
        },
        getEmail(profile) {
            return profile?.email || null;
        },
        getDisplayName(profile) {
            return profile?.name || profile?.email || null;
        },
        exchangeCode(code, redirectUri) {
            return this.requestToken({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
            });
        },
    },
    github: {
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        scopes: GITHUB_SCOPES,
        assertConfigured: assertGithubConfigured,
        requestToken: requestGithubToken,
        fetchProfile: fetchGithubProfile,
        persistTokens: persistGithubTokens,
        buildAuthorizeParams(clientId, redirectUri, scopes, state) {
            const url = new URL(this.authorizeUrl);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('redirect_uri', redirectUri);
            url.searchParams.set('scope', scopes.join(' '));
            url.searchParams.set('allow_signup', 'false');
            url.searchParams.set('state', state);
            return url.toString();
        },
        getProviderId(profile) {
            return profile?.id ? String(profile.id) : null;
        },
        getEmail(profile) {
            return profile?.email || null;
        },
        getDisplayName(profile) {
            return profile?.name || profile?.login || null;
        },
        exchangeCode(code, redirectUri) {
            return this.requestToken({ code, redirect_uri: redirectUri });
        },
    },
    discord: {
        authorizeUrl: 'https://discord.com/oauth2/authorize',
        scopes: DISCORD_SCOPES,
        assertConfigured: assertDiscordConfigured,
        requestToken: requestDiscordToken,
        fetchProfile: fetchDiscordProfile,
        persistTokens: persistDiscordTokens,
        buildAuthorizeParams(clientId, redirectUri, scopes, state) {
            const url = new URL(this.authorizeUrl);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('redirect_uri', redirectUri);
            url.searchParams.set('scope', scopes.join(' '));
            url.searchParams.set('state', state);
            url.searchParams.set('prompt', 'consent');
            return url.toString();
        },
        getProviderId(profile) {
            return profile?.id || null;
        },
        getEmail(profile) {
            return profile?.email || null;
        },
        getDisplayName(profile) {
            return profile?.global_name || profile?.username || null;
        },
        exchangeCode(code, redirectUri) {
            return this.requestToken({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
            });
        },
    },
};

function assertValidProvider(provider) {
    if (!VALID_PROVIDERS.includes(provider)) {
        throw createLinkedAccountError(
            400,
            'OAUTH_INVALID_PROVIDER',
            `Invalid OAuth provider: ${provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`
        );
    }
}

function getJwtSecret() {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
        throw createLinkedAccountError(
            500,
            'OAUTH_LOGIN_NOT_CONFIGURED',
            'JWT_SECRET is not configured.'
        );
    }
    return secret;
}

function signOAuthLoginState(payload) {
    return jwt.sign(
        {
            ...payload,
            type: 'oauth-login',
        },
        getJwtSecret(),
        { expiresIn: '10m' }
    );
}

function verifyOAuthLoginState(token) {
    try {
        const decoded = jwt.verify(String(token || ''), getJwtSecret());
        if (decoded?.type !== 'oauth-login') {
            throw new Error('invalid type');
        }
        return decoded;
    } catch (_error) {
        throw createLinkedAccountError(
            400,
            'OAUTH_STATE_INVALID',
            'The OAuth login URL has expired or is invalid.'
        );
    }
}

function getOAuthRedirectUri(provider) {
    const envKey = `${provider.toUpperCase()}_OAUTH_LOGIN_REDIRECT_URI`;
    const loginRedirect = String(process.env[envKey] || '').trim();
    if (loginRedirect) {
        return loginRedirect;
    }

    const fallbackKey = `${provider.toUpperCase()}_REDIRECT_URI`;
    const linkRedirect = String(process.env[fallbackKey] || '').trim();
    return linkRedirect;
}

function buildOAuthLoginUrl(provider, req) {
    assertValidProvider(provider);
    const config = PROVIDER_CONFIG[provider];
    const { clientId } = config.assertConfigured();
    const redirectUri = getOAuthRedirectUri(provider);
    const returnOrigin = resolveReturnOrigin(req);

    const state = signOAuthLoginState({
        provider,
        returnOrigin,
        nonce: crypto.randomUUID(),
    });

    return config.buildAuthorizeParams(clientId, redirectUri, config.scopes, state);
}

async function generateUniqueUsername(displayName) {
    const base = String(displayName || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || 'user';

    for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = crypto.randomInt(1000, 9999);
        const candidate = `${base}${suffix}`;

        const existing = await User.findOne({ username: candidate });
        if (!existing) {
            return candidate;
        }
    }

    return `user${crypto.randomUUID().slice(0, 8)}`;
}

async function completeOAuthLogin(provider, code, statePayload, reqMeta) {
    assertValidProvider(provider);
    const config = PROVIDER_CONFIG[provider];
    const redirectUri = getOAuthRedirectUri(provider);

    const tokenPayload = await config.exchangeCode(code, redirectUri);
    const rawProfile = await config.fetchProfile(tokenPayload.access_token);

    const providerId = config.getProviderId(rawProfile);
    const email = config.getEmail(rawProfile);
    const displayName = config.getDisplayName(rawProfile);

    if (!providerId) {
        throw createLinkedAccountError(
            502,
            'OAUTH_PROFILE_MISSING_ID',
            `${provider} did not return a user identifier.`
        );
    }

    let user = await User.findByOAuthProvider(provider, providerId);
    let isNewUser = false;

    if (!user && email) {
        user = await User.findOne({ email: email.toLowerCase(), isActive: true });
        if (user) {
            user.oauthProviders = user.oauthProviders || [];
            user.oauthProviders.push({
                provider,
                providerId,
                email,
                connectedAt: new Date(),
            });
        }
    }

    if (!user) {
        isNewUser = true;
        const username = await generateUniqueUsername(displayName);
        user = new User({
            username,
            email: email || `${provider}_${providerId}@oauth.local`,
            role: 'user',
            emailVerified: Boolean(email),
            oauthProviders: [{
                provider,
                providerId,
                email,
                connectedAt: new Date(),
            }],
        });
    }

    config.persistTokens(user, tokenPayload, rawProfile, { touchConnectedAt: true });

    const tokens = generateTokens(user);
    user.registerSession({
        sessionId: tokens.sessionId,
        refreshToken: tokens.refreshToken,
        userAgent: reqMeta.userAgent,
        ip: reqMeta.ip,
    });
    user.lastLogin = new Date();

    await user.save();

    return {
        user,
        tokens,
        isNewUser,
    };
}

function sanitizeCallbackErrorMessage(error) {
    return String(error || 'An error occurred during OAuth login.').slice(0, 180);
}

function buildOAuthCallbackUrl({ origin, status, error, tokens }) {
    const callbackUrl = new URL('/oauth/callback', origin || getDefaultClientOrigin());
    const fragment = new URLSearchParams();
    fragment.set('status', status);

    if (error) {
        fragment.set('error', sanitizeCallbackErrorMessage(error));
    }

    if (tokens) {
        fragment.set('accessToken', tokens.accessToken);
        fragment.set('refreshToken', tokens.refreshToken);
        if (tokens.sessionId) {
            fragment.set('sessionId', tokens.sessionId);
        }
    }

    callbackUrl.hash = fragment.toString();
    return callbackUrl.toString();
}

module.exports = {
    VALID_PROVIDERS,
    assertValidProvider,
    buildOAuthCallbackUrl,
    buildOAuthLoginUrl,
    completeOAuthLogin,
    generateUniqueUsername,
    signOAuthLoginState,
    verifyOAuthLoginState,
};
