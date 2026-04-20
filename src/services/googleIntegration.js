const crypto = require('crypto');

const {
    createLinkedAccountError,
    decryptLinkedAccountPayload,
    encryptLinkedAccountPayload,
    resolveReturnOrigin,
    serializeGenericLinkedAccount,
    signLinkedAccountState,
} = require('./linkedAccounts');

const GOOGLE_ACCOUNTS_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_PROFILE_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TASKS_API_BASE_URL = 'https://tasks.googleapis.com/tasks/v1';
const GOOGLE_GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';

const GOOGLE_SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/gmail.readonly',
];

const _googleCache = new Map();
const GOOGLE_CACHE_TTL_MS = 60_000;

function _getGoogleCached(key) {
    const entry = _googleCache.get(key);
    if (!entry || Date.now() - entry.ts > GOOGLE_CACHE_TTL_MS) {
        _googleCache.delete(key);
        return undefined;
    }
    return entry.value;
}

function _setGoogleCache(key, value) {
    _googleCache.set(key, { value, ts: Date.now() });
}

function assertGoogleConfigured() {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();

    if (!clientId || !clientSecret || !redirectUri) {
        throw createLinkedAccountError(
            500,
            'GOOGLE_NOT_CONFIGURED',
            'Google Workspace is not configured in the backend.'
        );
    }

    return { clientId, clientSecret, redirectUri };
}

function getMutableGoogleAccount(user) {
    user.linkedAccounts = user.linkedAccounts || {};
    if (!user.linkedAccounts.google) {
        user.linkedAccounts.google = {
            status: 'disconnected',
            scopes: [],
        };
    }

    return user.linkedAccounts.google;
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

function serializeGoogleProfile(profile) {
    return {
        id: profile?.sub || profile?.id || null,
        email: profile?.email || null,
        displayName: profile?.name || profile?.displayName || profile?.email || null,
        avatarUrl: profile?.picture || profile?.avatarUrl || null,
        locale: profile?.locale || null,
    };
}

function parseGoogleStatus(account) {
    return {
        status: account?.status || 'disconnected',
        profile: account?.profile || null,
        connectedAt: account?.connectedAt || null,
        tokenExpiresAt: account?.tokenExpiresAt || null,
        scopes: Array.isArray(account?.scopes) ? account.scopes : [],
        lastError: account?.lastError || null,
    };
}

async function parseGoogleResponse(response) {
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

    try {
        return await response.text();
    } catch (_error) {
        return null;
    }
}

function getGoogleErrorMessage(payload, fallback) {
    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    if (typeof payload?.error_description === 'string' && payload.error_description.trim()) {
        return payload.error_description.trim();
    }

    if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }

    if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
        return payload.error.message.trim();
    }

    return fallback;
}

function createGoogleApiError(response, payload) {
    const message = getGoogleErrorMessage(payload, `Google returned error ${response.status}.`);

    if (response.status === 401) {
        return createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Google Workspace needs you to link your account again.',
            payload
        );
    }

    if (response.status === 403) {
        return createLinkedAccountError(
            403,
            'GOOGLE_SCOPE_REQUIRED',
            message,
            payload
        );
    }

    return createLinkedAccountError(
        502,
        'GOOGLE_API_ERROR',
        message,
        payload
    );
}

async function requestGoogleToken(params) {
    const { clientId, clientSecret, redirectUri } = assertGoogleConfigured();
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

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    const payload = await parseGoogleResponse(response);

    if (!response.ok) {
        if (response.status === 400 && payload?.error === 'invalid_grant') {
            throw createLinkedAccountError(
                412,
                'REAUTH_REQUIRED',
                'The Google Workspace link has expired and must be reconnected.',
                payload
            );
        }

        throw createGoogleApiError(response, payload);
    }

    return payload;
}

async function fetchGoogleProfile(accessToken) {
    const response = await fetch(GOOGLE_PROFILE_URL, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const payload = await parseGoogleResponse(response);

    if (!response.ok) {
        throw createGoogleApiError(response, payload);
    }

    return payload;
}

function readGoogleCredentials(user) {
    const google = user?.linkedAccounts?.google;
    if (!google?.credentials) {
        return null;
    }

    return decryptLinkedAccountPayload(google.credentials);
}

function persistGoogleTokens(user, tokenPayload, profile, options = {}) {
    const google = getMutableGoogleAccount(user);
    const currentCredentials = readGoogleCredentials(user) || {};
    const refreshToken = tokenPayload.refresh_token || currentCredentials.refreshToken || null;
    const expiresIn = Number(tokenPayload.expires_in);

    google.status = 'connected';
    google.profile = serializeGoogleProfile(profile || google.profile || {});
    google.scopes = getGrantedScopes(tokenPayload.scope, google.scopes);
    google.connectedAt =
        options.touchConnectedAt || !google.connectedAt
            ? new Date()
            : google.connectedAt;
    google.tokenExpiresAt = Number.isFinite(expiresIn)
        ? new Date(Date.now() + expiresIn * 1000)
        : null;
    google.lastError = null;
    google.credentials = encryptLinkedAccountPayload({
        accessToken: tokenPayload.access_token,
        refreshToken,
        scope: tokenPayload.scope || google.scopes.join(' '),
        tokenType: tokenPayload.token_type || 'Bearer',
    });

    return google;
}

async function markGoogleReauthRequired(user, reason) {
    const google = getMutableGoogleAccount(user);
    google.status = 'reauth_required';
    google.tokenExpiresAt = null;
    google.lastError = reason || 'Google Workspace needs you to link your account again.';
    google.credentials = undefined;
    await user.save();
    return google;
}

function assertGoogleLinked(user) {
    const google = user?.linkedAccounts?.google;

    if (!google || google.status === 'disconnected' || !google.credentials) {
        throw createLinkedAccountError(
            412,
            'LINKED_ACCOUNT_REQUIRED',
            'Link your Google Workspace account from Account to use this integration.'
        );
    }

    if (google.status === 'reauth_required') {
        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Google Workspace needs you to link your account again.'
        );
    }

    return google;
}

async function refreshGoogleAccessToken(user) {
    const google = assertGoogleLinked(user);
    const credentials = readGoogleCredentials(user);

    if (!credentials?.refreshToken) {
        await markGoogleReauthRequired(
            user,
            'The Google Workspace link does not have a valid refresh token.'
        );

        throw createLinkedAccountError(
            412,
            'REAUTH_REQUIRED',
            'Google Workspace needs you to link your account again.'
        );
    }

    try {
        const payload = await requestGoogleToken({
            grant_type: 'refresh_token',
            refresh_token: credentials.refreshToken,
        });

        persistGoogleTokens(user, {
            ...payload,
            refresh_token: credentials.refreshToken,
            scope: payload.scope || google.scopes.join(' '),
        }, google.profile);

        await user.save();
        return readGoogleCredentials(user)?.accessToken || payload.access_token;
    } catch (error) {
        if (error.code === 'REAUTH_REQUIRED') {
            await markGoogleReauthRequired(user, error.message);
        }

        throw error;
    }
}

async function ensureGoogleAccessToken(user) {
    assertGoogleConfigured();
    const google = assertGoogleLinked(user);
    const credentials = readGoogleCredentials(user);

    if (!credentials?.accessToken) {
        return refreshGoogleAccessToken(user);
    }

    const expiresAt = google?.tokenExpiresAt ? new Date(google.tokenExpiresAt).getTime() : 0;
    if (!expiresAt || expiresAt > Date.now() + 60 * 1000) {
        return credentials.accessToken;
    }

    return refreshGoogleAccessToken(user);
}

async function executeGoogleApiRequest(accessToken, url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);

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

async function googleApiRequestResult(user, response) {
    const payload = await parseGoogleResponse(response);

    if (!response.ok) {
        const error = createGoogleApiError(response, payload);
        if (error.code === 'REAUTH_REQUIRED') {
            await markGoogleReauthRequired(user, error.message);
        }
        throw error;
    }

    return payload;
}

async function googleApiRequest(user, url, options = {}, retryOnUnauthorized = true) {
    const accessToken = await ensureGoogleAccessToken(user);
    const response = await executeGoogleApiRequest(accessToken, url, options);

    if (response.status === 401 && retryOnUnauthorized) {
        const nextToken = await refreshGoogleAccessToken(user);
        const retryResponse = await executeGoogleApiRequest(nextToken, url, options);
        return googleApiRequestResult(user, retryResponse);
    }

    return googleApiRequestResult(user, response);
}

function buildGoogleAuthorizeUrl(user, sessionId, req) {
    const { clientId, redirectUri } = assertGoogleConfigured();
    const returnOrigin = resolveReturnOrigin(req);

    const state = signLinkedAccountState({
        provider: 'google',
        userId: String(user._id),
        sessionId,
        returnOrigin,
        nonce: crypto.randomUUID(),
    });

    const authorizeUrl = new URL(GOOGLE_ACCOUNTS_BASE_URL);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    authorizeUrl.searchParams.set('access_type', 'offline');
    authorizeUrl.searchParams.set('prompt', 'consent');
    authorizeUrl.searchParams.set('include_granted_scopes', 'true');
    authorizeUrl.searchParams.set('state', state);

    return authorizeUrl.toString();
}

async function completeGoogleLink(user, code) {
    const tokenPayload = await requestGoogleToken({
        grant_type: 'authorization_code',
        code,
    });

    const profile = await fetchGoogleProfile(tokenPayload.access_token);
    persistGoogleTokens(user, tokenPayload, profile, { touchConnectedAt: true });
    await user.save();
    return parseGoogleStatus(user.linkedAccounts?.google);
}

async function disconnectGoogleAccount(user) {
    user.clearLinkedAccount('google');
    await user.save();
    return parseGoogleStatus(user.linkedAccounts?.google);
}

async function getGoogleStatus(user) {
    assertGoogleConfigured();
    return parseGoogleStatus(user?.linkedAccounts?.google);
}

function normalizeGoogleDateTime(dateTimeValue, dateValue) {
    if (typeof dateTimeValue === 'string' && dateTimeValue.trim()) {
        return dateTimeValue;
    }

    if (typeof dateValue === 'string' && dateValue.trim()) {
        return `${dateValue}T00:00:00.000Z`;
    }

    return null;
}

function serializeGoogleCalendarEvent(event) {
    const startAt = normalizeGoogleDateTime(event?.start?.dateTime, event?.start?.date);
    const endAt = normalizeGoogleDateTime(event?.end?.dateTime, event?.end?.date);

    return {
        id: event?.id || null,
        title: event?.summary || 'Untitled event',
        startAt,
        endAt,
        location: event?.location || null,
        htmlUrl: event?.htmlLink || null,
        meetingUrl: event?.hangoutLink || null,
        status: event?.status || 'confirmed',
        organizer: event?.organizer?.email || event?.creator?.email || null,
        isAllDay: Boolean(event?.start?.date && !event?.start?.dateTime),
    };
}

function compareDatesAsc(leftValue, rightValue) {
    const left = leftValue ? new Date(leftValue).getTime() : Number.MAX_SAFE_INTEGER;
    const right = rightValue ? new Date(rightValue).getTime() : Number.MAX_SAFE_INTEGER;
    return left - right;
}

async function getGoogleCalendarAgenda(user, options = {}) {
    const limit = Math.max(1, Math.min(12, Number(options.limit) || 6));
    const calendarId = options.calendarId || 'primary';
    const now = new Date();
    const timeMax = new Date(Date.now() + (Number(options.horizonDays) || 7) * 24 * 60 * 60 * 1000);
    const url = new URL(`${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('maxResults', String(limit));
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('timeMin', now.toISOString());
    url.searchParams.set('timeMax', timeMax.toISOString());

    const payload = await googleApiRequest(user, url.toString());
    const items = Array.isArray(payload?.items)
        ? payload.items.map(serializeGoogleCalendarEvent).sort((left, right) => (
            compareDatesAsc(left.startAt, right.startAt)
        ))
        : [];

    const activeEvent = items.find((item) => {
        const start = item.startAt ? new Date(item.startAt).getTime() : 0;
        const end = item.endAt ? new Date(item.endAt).getTime() : 0;
        const nowValue = now.getTime();
        return start <= nowValue && end >= nowValue;
    }) || null;

    return {
        busyNow: Boolean(activeEvent),
        activeEventId: activeEvent?.id || null,
        nextStartAt: items[0]?.startAt || null,
        nextEndAt: items[0]?.endAt || null,
        items,
    };
}

function normalizeGoogleTaskDue(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeGoogleTask(task, taskListId, taskListTitle) {
    return {
        id: task?.id || null,
        taskListId,
        taskListTitle: taskListTitle || null,
        title: task?.title || 'Untitled task',
        status: task?.status || 'needsAction',
        due: normalizeGoogleTaskDue(task?.due),
        updatedAt: task?.updated || null,
        notes: task?.notes || null,
        webViewLink: task?.webViewLink || null,
    };
}

function compareGoogleTasks(left, right) {
    const leftDue = left.due ? new Date(left.due).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.due ? new Date(right.due).getTime() : Number.MAX_SAFE_INTEGER;

    if (leftDue !== rightDue) {
        return leftDue - rightDue;
    }

    const leftUpdated = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightUpdated = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    return rightUpdated - leftUpdated;
}

function isTaskDueToday(task, now = new Date()) {
    if (!task?.due) return false;
    const due = new Date(task.due);
    if (Number.isNaN(due.getTime())) return false;

    return due.getUTCFullYear() === now.getUTCFullYear()
        && due.getUTCMonth() === now.getUTCMonth()
        && due.getUTCDate() === now.getUTCDate();
}

function isTaskOverdue(task, now = new Date()) {
    if (!task?.due) return false;
    const due = new Date(task.due).getTime();
    return Number.isFinite(due) && due < now.getTime() && task.status !== 'completed';
}

async function getGoogleTasksSummary(user, options = {}) {
    const taskListsLimit = Math.max(1, Math.min(5, Number(options.taskListsLimit) || 3));
    const itemsLimit = Math.max(3, Math.min(20, Number(options.itemsLimit) || 8));
    const taskListsUrl = new URL(`${GOOGLE_TASKS_API_BASE_URL}/users/@me/lists`);
    taskListsUrl.searchParams.set('maxResults', String(taskListsLimit));

    const taskListsPayload = await googleApiRequest(user, taskListsUrl.toString());
    const taskLists = Array.isArray(taskListsPayload?.items) ? taskListsPayload.items : [];

    const itemBatches = await Promise.all(
        taskLists.slice(0, taskListsLimit).map(async (taskList) => {
            const tasksUrl = new URL(`${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(taskList.id)}/tasks`);
            tasksUrl.searchParams.set('showCompleted', 'false');
            tasksUrl.searchParams.set('showHidden', 'false');
            tasksUrl.searchParams.set('maxResults', String(itemsLimit));
            const tasksPayload = await googleApiRequest(user, tasksUrl.toString());
            const taskItems = Array.isArray(tasksPayload?.items) ? tasksPayload.items : [];
            return taskItems.map((task) => serializeGoogleTask(task, taskList.id, taskList.title));
        })
    );
    const items = itemBatches.flat();

    const now = new Date();
    const sortedItems = items
        .filter((task) => task.status !== 'completed')
        .sort(compareGoogleTasks)
        .slice(0, itemsLimit);

    return {
        taskLists: taskLists.map((taskList) => ({
            id: taskList.id || null,
            title: taskList.title || 'Untitled list',
        })),
        items: sortedItems,
        dueTodayCount: sortedItems.filter((task) => isTaskDueToday(task, now)).length,
        overdueCount: sortedItems.filter((task) => isTaskOverdue(task, now)).length,
    };
}

function getHeaderValue(headers, name) {
    if (!Array.isArray(headers)) return null;
    const found = headers.find((header) => String(header?.name || '').toLowerCase() === name.toLowerCase());
    return found?.value || null;
}

function serializeGoogleInboxMessage(message, details) {
    const headers = details?.payload?.headers || [];

    return {
        id: message?.id || details?.id || null,
        threadId: message?.threadId || details?.threadId || null,
        subject: getHeaderValue(headers, 'Subject') || '(No subject)',
        from: getHeaderValue(headers, 'From'),
        date: getHeaderValue(headers, 'Date'),
        snippet: details?.snippet || null,
    };
}

async function getGoogleInboxSummary(user, options = {}) {
    const itemsLimit = Math.max(1, Math.min(10, Number(options.itemsLimit) || 5));
    const unreadLabel = await googleApiRequest(user, `${GOOGLE_GMAIL_API_BASE_URL}/users/me/labels/UNREAD`);
    const messagesUrl = new URL(`${GOOGLE_GMAIL_API_BASE_URL}/users/me/messages`);
    messagesUrl.searchParams.set('q', 'is:unread -category:promotions -category:social');
    messagesUrl.searchParams.set('maxResults', String(itemsLimit));

    const messagesPayload = await googleApiRequest(user, messagesUrl.toString());
    const messages = Array.isArray(messagesPayload?.messages) ? messagesPayload.messages : [];

    const items = await Promise.all(
        messages.slice(0, itemsLimit).map(async (message) => {
            const detailsUrl = new URL(`${GOOGLE_GMAIL_API_BASE_URL}/users/me/messages/${encodeURIComponent(message.id)}`);
            detailsUrl.searchParams.set('format', 'metadata');
            detailsUrl.searchParams.append('metadataHeaders', 'From');
            detailsUrl.searchParams.append('metadataHeaders', 'Subject');
            detailsUrl.searchParams.append('metadataHeaders', 'Date');
            const details = await googleApiRequest(user, detailsUrl.toString());
            return serializeGoogleInboxMessage(message, details);
        })
    );

    return {
        unreadCount: Number(unreadLabel?.messagesUnread) || items.length,
        threadUnreadCount: Number(unreadLabel?.threadsUnread) || 0,
        items,
    };
}

function buildGoogleFocusSummary(calendar, tasks, inbox) {
    const nextEvent = calendar.items?.[0] || null;
    const overdueCount = Number(tasks?.overdueCount) || 0;
    const dueTodayCount = Number(tasks?.dueTodayCount) || 0;
    const unreadCount = Number(inbox?.unreadCount) || 0;
    const now = Date.now();
    const nextEventStart = nextEvent?.startAt ? new Date(nextEvent.startAt).getTime() : 0;
    const nextEventSoon = nextEventStart && nextEventStart - now <= 30 * 60 * 1000;

    let active = false;
    let reason = null;
    let nextTransitionAt = null;

    if (calendar.busyNow) {
        active = true;
        reason = 'calendar';
        nextTransitionAt = calendar.nextEndAt || null;
    } else if (nextEventSoon) {
        active = true;
        reason = 'upcoming_event';
        nextTransitionAt = nextEvent?.startAt || null;
    } else if (overdueCount > 0 || dueTodayCount >= 3) {
        active = true;
        reason = 'tasks';
    } else if (unreadCount >= 10) {
        active = true;
        reason = 'inbox';
    }

    return {
        active,
        reason,
        nextTransitionAt,
        dueTodayCount,
        overdueCount,
        unreadCount,
        recommendedIntentTags: ['luces', 'spotify', 'presencia', 'focus'],
    };
}

function createGoogleSectionFallback(baseSection, error) {
    return {
        ...baseSection,
        error: error?.message || 'Section unavailable.',
    };
}

async function getGoogleWorkspaceSummary(user, options = {}) {
    const userId = String(user?._id || '');
    const cacheKey = `workspace:${userId}`;
    const cached = _getGoogleCached(cacheKey);
    if (cached) return cached;

    const provider = parseGoogleStatus(user?.linkedAccounts?.google);
    const disconnectedMessage = provider.status === 'reauth_required'
        ? 'Reconnect Google Workspace from Account to restore all widgets.'
        : 'Link your Google Workspace account from Account to unlock these widgets.';

    if (provider.status !== 'connected') {
        return {
            provider,
            calendar: createGoogleSectionFallback({
                busyNow: false,
                activeEventId: null,
                nextStartAt: null,
                nextEndAt: null,
                items: [],
            }, new Error(disconnectedMessage)),
            tasks: createGoogleSectionFallback({
                taskLists: [],
                items: [],
                dueTodayCount: 0,
                overdueCount: 0,
            }, new Error(disconnectedMessage)),
            inbox: createGoogleSectionFallback({
                unreadCount: 0,
                threadUnreadCount: 0,
                items: [],
            }, new Error(disconnectedMessage)),
            focus: {
                active: false,
                reason: null,
                nextTransitionAt: null,
                dueTodayCount: 0,
                overdueCount: 0,
                unreadCount: 0,
                recommendedIntentTags: ['luces', 'spotify', 'presencia', 'focus'],
                error: disconnectedMessage,
            },
        };
    }

    const [calendar, tasks, inbox] = await Promise.all([
        getGoogleCalendarAgenda(user, options.calendar || {})
            .catch((error) => createGoogleSectionFallback({
                busyNow: false,
                activeEventId: null,
                nextStartAt: null,
                nextEndAt: null,
                items: [],
            }, error)),
        getGoogleTasksSummary(user, options.tasks || {})
            .catch((error) => createGoogleSectionFallback({
                taskLists: [],
                items: [],
                dueTodayCount: 0,
                overdueCount: 0,
            }, error)),
        getGoogleInboxSummary(user, options.inbox || {})
            .catch((error) => createGoogleSectionFallback({
                unreadCount: 0,
                threadUnreadCount: 0,
                items: [],
            }, error)),
    ]);
    const focus = buildGoogleFocusSummary(calendar, tasks, inbox);

    if (calendar.error || tasks.error || inbox.error) {
        focus.error = calendar.error || tasks.error || inbox.error;
    }

    const result = {
        provider,
        calendar,
        tasks,
        inbox,
        focus,
    };
    _setGoogleCache(cacheKey, result);
    return result;
}

async function completeGoogleTask(user, taskListId, taskId) {
    const payload = await googleApiRequest(
        user,
        `${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
        {
            method: 'PATCH',
            body: {
                status: 'completed',
                completed: new Date().toISOString(),
            },
        }
    );

    return serializeGoogleTask(payload, taskListId, null);
}

async function rescheduleGoogleTask(user, taskListId, taskId, due) {
    const normalizedDue = normalizeGoogleTaskDue(due);
    if (!normalizedDue) {
        throw createLinkedAccountError(
            400,
            'GOOGLE_TASK_DUE_INVALID',
            'A valid RFC3339 due date is required to reschedule the task.'
        );
    }

    const payload = await googleApiRequest(
        user,
        `${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
        {
            method: 'PATCH',
            body: {
                due: normalizedDue,
                status: 'needsAction',
            },
        }
    );

    return serializeGoogleTask(payload, taskListId, null);
}

module.exports = {
    GOOGLE_SCOPES,
    buildGoogleAuthorizeUrl,
    completeGoogleLink,
    completeGoogleTask,
    disconnectGoogleAccount,
    getGoogleStatus,
    getGoogleWorkspaceSummary,
    rescheduleGoogleTask,
};
