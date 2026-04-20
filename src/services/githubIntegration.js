const crypto = require('crypto');

const {
    createLinkedAccountError,
    decryptLinkedAccountPayload,
    encryptLinkedAccountPayload,
    resolveReturnOrigin,
    signLinkedAccountState,
} = require('./linkedAccounts');

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

const GITHUB_SCOPES = ['read:user', 'user:email', 'notifications', 'repo'];

const _githubCache = new Map();
const GITHUB_CACHE_TTL_MS = 60_000;

function _getGithubCached(key) {
    const entry = _githubCache.get(key);
    if (!entry || Date.now() - entry.ts > GITHUB_CACHE_TTL_MS) {
        _githubCache.delete(key);
        return undefined;
    }
    return entry.value;
}

function _setGithubCache(key, value) {
    _githubCache.set(key, { value, ts: Date.now() });
}

function assertGithubConfigured() {
    const clientId = String(process.env.GITHUB_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.GITHUB_CLIENT_SECRET || '').trim();
    const redirectUri = String(process.env.GITHUB_REDIRECT_URI || '').trim();

    if (!clientId || !clientSecret || !redirectUri) {
        throw createLinkedAccountError(
            500,
            'GITHUB_NOT_CONFIGURED',
            'GitHub is not configured in the backend.'
        );
    }

    return { clientId, clientSecret, redirectUri };
}

function getMutableGithubAccount(user) {
    user.linkedAccounts = user.linkedAccounts || {};
    if (!user.linkedAccounts.github) {
        user.linkedAccounts.github = {
            status: 'disconnected',
            scopes: [],
        };
    }

    return user.linkedAccounts.github;
}

function getGrantedScopes(scopeValue, fallback = []) {
    const nextScopes = String(scopeValue || '')
        .split(/[ ,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);

    if (nextScopes.length > 0) {
        return Array.from(new Set(nextScopes));
    }

    return Array.from(new Set(Array.isArray(fallback) ? fallback : []));
}

function serializeGithubProfile(profile) {
    return {
        id: profile?.id ? String(profile.id) : null,
        login: profile?.login || null,
        displayName: profile?.name || profile?.displayName || profile?.login || null,
        email: profile?.email || null,
        avatarUrl: profile?.avatar_url || profile?.avatarUrl || null,
        htmlUrl: profile?.html_url || profile?.htmlUrl || null,
    };
}

function parseGithubStatus(account) {
    return {
        status: account?.status || 'disconnected',
        profile: account?.profile || null,
        connectedAt: account?.connectedAt || null,
        tokenExpiresAt: account?.tokenExpiresAt || null,
        scopes: Array.isArray(account?.scopes) ? account.scopes : [],
        lastError: account?.lastError || null,
    };
}

async function parseGithubResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 204) {
        return null;
    }

    if (contentType.includes('application/json')) {
        try {
            return await response.json();
        } catch (_error) {
            return null;
        }
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
        try {
            const text = await response.text();
            const params = new URLSearchParams(text);
            return Object.fromEntries(params.entries());
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

function getGithubErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    if (typeof payload?.error_description === 'string' && payload.error_description.trim()) {
        return payload.error_description.trim();
    }

    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }

    return fallback;
}

function createGithubApiError(response, payload) {
    const message = getGithubErrorMessage(payload, `GitHub returned error ${response.status}.`);

    if (response.status === 401) {
        return createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'GitHub needs you to link your account again.',
            payload
        );
    }

    return createLinkedAccountError(
        502,
        'GITHUB_API_ERROR',
        message,
        payload
    );
}

async function requestGithubToken(params) {
    const { clientId, clientSecret, redirectUri } = assertGithubConfigured();
    const body = new URLSearchParams();

    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            body.set(key, String(value));
        }
    }

    if (params.grant_type === 'authorization_code' && !body.has('redirect_uri')) {
        body.set('redirect_uri', redirectUri);
    }

    const response = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    const payload = await parseGithubResponse(response);

    if (!response.ok) {
        throw createGithubApiError(response, payload);
    }

    if (payload?.error) {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            getGithubErrorMessage(payload, 'GitHub authorization was rejected.'),
            payload
        );
    }

    return payload;
}

async function fetchGithubProfile(accessToken) {
    const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
    });

    const payload = await parseGithubResponse(response);

    if (!response.ok) {
        throw createGithubApiError(response, payload);
    }

    if (!payload?.email) {
        const emailsResponse = await fetch(`${GITHUB_API_BASE_URL}/user/emails`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
            },
        });
        const emailsPayload = await parseGithubResponse(emailsResponse);
        if (emailsResponse.ok && Array.isArray(emailsPayload)) {
            const primaryEmail = emailsPayload.find((entry) => entry.primary) || emailsPayload[0];
            if (primaryEmail?.email) {
                payload.email = primaryEmail.email;
            }
        }
    }

    return payload;
}

function readGithubCredentials(user) {
    const github = user?.linkedAccounts?.github;
    if (!github?.credentials) {
        return null;
    }

    return decryptLinkedAccountPayload(github.credentials);
}

function persistGithubTokens(user, tokenPayload, profile, options = {}) {
    const github = getMutableGithubAccount(user);
    const expiresIn = Number(tokenPayload.expires_in);

    github.status = 'connected';
    github.profile = serializeGithubProfile(profile || github.profile || {});
    github.scopes = getGrantedScopes(tokenPayload.scope, github.scopes);
    github.connectedAt =
        options.touchConnectedAt || !github.connectedAt
            ? new Date()
            : github.connectedAt;
    github.tokenExpiresAt = Number.isFinite(expiresIn)
        ? new Date(Date.now() + expiresIn * 1000)
        : null;
    github.lastError = null;
    github.credentials = encryptLinkedAccountPayload({
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token || null,
        scope: tokenPayload.scope || github.scopes.join(' '),
        tokenType: tokenPayload.token_type || 'Bearer',
    });

    return github;
}

async function markGithubReauthRequired(user, reason) {
    const github = getMutableGithubAccount(user);
    github.status = 'reauth_required';
    github.tokenExpiresAt = null;
    github.lastError = reason || 'GitHub needs you to link your account again.';
    github.credentials = undefined;
    await user.save();
    return github;
}

function assertGithubLinked(user) {
    const github = user?.linkedAccounts?.github;

    if (!github || github.status === 'disconnected' || !github.credentials) {
        throw createLinkedAccountError(
            412,
            'LINKED_ACCOUNT_REQUIRED',
            'Link your GitHub account from Account to use this integration.'
        );
    }

    if (github.status === 'reauth_required') {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'GitHub needs you to link your account again.'
        );
    }

    return github;
}

async function refreshGithubAccessToken(user) {
    const github = assertGithubLinked(user);
    const credentials = readGithubCredentials(user);

    if (!credentials?.refreshToken) {
        await markGithubReauthRequired(user, 'The GitHub link must be reconnected.');
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'GitHub needs you to link your account again.'
        );
    }

    const payload = await requestGithubToken({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
    });

    persistGithubTokens(user, {
        ...payload,
        refresh_token: payload.refresh_token || credentials.refreshToken,
        scope: payload.scope || github.scopes.join(','),
    }, github.profile);
    await user.save();

    return readGithubCredentials(user)?.accessToken || payload.access_token;
}

async function ensureGithubAccessToken(user) {
    assertGithubConfigured();
    const github = assertGithubLinked(user);
    const credentials = readGithubCredentials(user);

    if (!credentials?.accessToken) {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'GitHub needs you to link your account again.'
        );
    }

    const expiresAt = github?.tokenExpiresAt ? new Date(github.tokenExpiresAt).getTime() : 0;
    if (!expiresAt || expiresAt > Date.now() + 60 * 1000) {
        return credentials.accessToken;
    }

    return refreshGithubAccessToken(user);
}

async function executeGithubApiRequest(accessToken, url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION);

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof URLSearchParams) && !(body instanceof Buffer)) {
        if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        body = JSON.stringify(body);
    }

    return fetch(url, {
        method: options.method || 'GET',
        headers,
        body,
    });
}

async function githubApiRequestResult(user, response) {
    const payload = await parseGithubResponse(response);

    if (!response.ok) {
        const error = createGithubApiError(response, payload);
        if (error.code === 'REAUTH_REQUIRED') {
            await markGithubReauthRequired(user, error.message);
        }
        throw error;
    }

    return payload;
}

async function githubApiRequest(user, url, options = {}, retryOnUnauthorized = true) {
    const accessToken = await ensureGithubAccessToken(user);
    const response = await executeGithubApiRequest(accessToken, url, options);

    if (response.status === 401 && retryOnUnauthorized && readGithubCredentials(user)?.refreshToken) {
        const nextToken = await refreshGithubAccessToken(user);
        const retryResponse = await executeGithubApiRequest(nextToken, url, options);
        return githubApiRequestResult(user, retryResponse);
    }

    return githubApiRequestResult(user, response);
}

function buildGithubAuthorizeUrl(user, sessionId, req) {
    const { clientId, redirectUri } = assertGithubConfigured();
    const returnOrigin = resolveReturnOrigin(req);

    const state = signLinkedAccountState({
        provider: 'github',
        userId: String(user._id),
        sessionId,
        returnOrigin,
        nonce: crypto.randomUUID(),
    });

    const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', GITHUB_SCOPES.join(' '));
    authorizeUrl.searchParams.set('allow_signup', 'false');
    authorizeUrl.searchParams.set('state', state);

    return authorizeUrl.toString();
}

async function completeGithubLink(user, code) {
    const tokenPayload = await requestGithubToken({ code });
    const profile = await fetchGithubProfile(tokenPayload.access_token);
    persistGithubTokens(user, tokenPayload, profile, { touchConnectedAt: true });
    await user.save();
    return parseGithubStatus(user.linkedAccounts?.github);
}

async function disconnectGithubAccount(user) {
    user.clearLinkedAccount('github');
    await user.save();
    return parseGithubStatus(user.linkedAccounts?.github);
}

async function getGithubStatus(user) {
    assertGithubConfigured();
    return parseGithubStatus(user?.linkedAccounts?.github);
}

function buildGithubWebUrl(apiUrl, fallbackRepository) {
    if (!apiUrl) return null;

    try {
        const url = new URL(apiUrl);
        const match = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/(pulls|issues)\/(\d+)/);
        if (match) {
            const [, repository, kind, number] = match;
            const segment = kind === 'pulls' ? 'pull' : 'issues';
            return `https://github.com/${repository}/${segment}/${number}`;
        }
    } catch (_error) {
        return fallbackRepository ? `https://github.com/${fallbackRepository}` : null;
    }

    return fallbackRepository ? `https://github.com/${fallbackRepository}` : null;
}

async function getPullRequestChecks(user, repository, sha) {
    if (!repository || !sha) {
        return {
            state: 'unknown',
            totalCount: 0,
            hasFailingChecks: false,
        };
    }

    const response = await githubApiRequest(
        user,
        `${GITHUB_API_BASE_URL}/repos/${repository}/commits/${sha}/status`
    );
    const state = response?.state || 'unknown';

    return {
        state,
        totalCount: Array.isArray(response?.statuses) ? response.statuses.length : 0,
        hasFailingChecks: state === 'failure' || state === 'error',
    };
}

async function getAssignedPullRequests(user, login, limit) {
    if (!login) {
        return [];
    }

    const searchUrl = new URL(`${GITHUB_API_BASE_URL}/search/issues`);
    searchUrl.searchParams.set(
        'q',
        `is:pr state:open archived:false assignee:${login}`
    );
    searchUrl.searchParams.set('sort', 'updated');
    searchUrl.searchParams.set('order', 'desc');
    searchUrl.searchParams.set('per_page', String(limit));

    const payload = await githubApiRequest(user, searchUrl.toString());
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const pullRequests = await Promise.all(
        items.slice(0, limit).map(async (item) => {
            const repository = String(item?.repository_url || '')
                .replace(`${GITHUB_API_BASE_URL}/repos/`, '')
                .trim();
            const details = item?.pull_request?.url
                ? await githubApiRequest(user, item.pull_request.url)
                : null;
            const checks = await getPullRequestChecks(user, repository, details?.head?.sha || null)
                .catch(() => ({
                    state: 'unknown',
                    totalCount: 0,
                    hasFailingChecks: false,
                }));

            return {
                id: item?.id || null,
                number: item?.number || null,
                repository,
                title: item?.title || 'Untitled pull request',
                updatedAt: item?.updated_at || null,
                url: item?.html_url || buildGithubWebUrl(item?.pull_request?.url, repository),
                hasFailingChecks: checks.hasFailingChecks,
                checksState: checks.state,
                checksCount: checks.totalCount,
            };
        })
    );

    return pullRequests;
}

async function getGithubNotifications(user, limit) {
    const notificationsUrl = new URL(`${GITHUB_API_BASE_URL}/notifications`);
    notificationsUrl.searchParams.set('all', 'false');
    notificationsUrl.searchParams.set('participating', 'false');
    notificationsUrl.searchParams.set('per_page', String(limit));

    const payload = await githubApiRequest(user, notificationsUrl.toString());
    const items = Array.isArray(payload) ? payload : [];

    return items.slice(0, limit).map((notification) => {
        const repository = notification?.repository?.full_name || null;
        return {
            id: notification?.id || null,
            reason: notification?.reason || 'subscribed',
            repository,
            title: notification?.subject?.title || 'Untitled notification',
            type: notification?.subject?.type || 'Unknown',
            unread: Boolean(notification?.unread),
            updatedAt: notification?.updated_at || null,
            url: buildGithubWebUrl(notification?.subject?.url, repository),
        };
    });
}

async function getGithubPulse(user, options = {}) {
    const userId = String(user?._id || '');
    const cacheKey = `pulse:${userId}`;
    const cached = _getGithubCached(cacheKey);
    if (cached) return cached;

    const provider = parseGithubStatus(user?.linkedAccounts?.github);
    const disconnectedMessage = provider.status === 'reauth_required'
        ? 'Reconnect GitHub from Account to restore pulse data.'
        : 'Link your GitHub account from Account to unlock this widget.';

    if (provider.status !== 'connected') {
        return {
            provider,
            profile: provider.profile || {},
            assignedPullRequests: [],
            notifications: [],
            mentionsCount: 0,
            failingChecksCount: 0,
            error: disconnectedMessage,
        };
    }

    const notificationsLimit = Math.max(3, Math.min(12, Number(options.notificationsLimit) || 8));
    const pullsLimit = Math.max(1, Math.min(10, Number(options.pullsLimit) || 5));
    const [liveProfile, notifications] = await Promise.all([
        githubApiRequest(user, `${GITHUB_API_BASE_URL}/user`)
            .catch(() => provider.profile || {}),
        getGithubNotifications(user, notificationsLimit)
            .catch(() => []),
    ]);
    const profile = serializeGithubProfile(liveProfile);
    const assignedPullRequests = await getAssignedPullRequests(user, profile.login, pullsLimit)
        .catch(() => []);

    const result = {
        provider,
        profile,
        assignedPullRequests,
        notifications,
        mentionsCount: notifications.filter((item) => (
            item.reason === 'mention' || item.reason === 'review_requested'
        )).length,
        failingChecksCount: assignedPullRequests.filter((item) => item.hasFailingChecks).length,
    };
    _setGithubCache(cacheKey, result);
    return result;
}

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

async function githubGraphQL(user, query, variables = {}) {
    const accessToken = await ensureGithubAccessToken(user);
    const response = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        body: JSON.stringify({ query, variables }),
    });

    if (response.status === 401 && readGithubCredentials(user)?.refreshToken) {
        const nextToken = await refreshGithubAccessToken(user);
        const retryResponse = await fetch(GITHUB_GRAPHQL_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${nextToken}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
            },
            body: JSON.stringify({ query, variables }),
        });
        const payload = await retryResponse.json();
        if (payload.errors) {
            throw createLinkedAccountError(400, 'GITHUB_GRAPHQL_ERROR', payload.errors[0]?.message || 'GraphQL error');
        }
        return payload.data;
    }

    const payload = await response.json();
    if (payload.errors) {
        throw createLinkedAccountError(400, 'GITHUB_GRAPHQL_ERROR', payload.errors[0]?.message || 'GraphQL error');
    }
    return payload.data;
}

module.exports = {
    GITHUB_SCOPES,
    buildGithubAuthorizeUrl,
    completeGithubLink,
    disconnectGithubAccount,
    getGithubPulse,
    getGithubStatus,
    githubGraphQL,
};
