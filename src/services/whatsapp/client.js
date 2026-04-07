const EventEmitter = require('events');
const qrcode = require('qrcode');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { WhatsAppMongoStore } = require('./store');

const SESSION_PREFIX = sanitizeSessionPart(
    process.env.WHATSAPP_SESSION_PREFIX ||
    process.env.WHATSAPP_SESSION_ID ||
    'personal-whatsapp'
);

const CLIENT_IDLE_TTL_MS = Math.max(
    Number(process.env.WHATSAPP_CLIENT_IDLE_TTL_MS ?? 15 * 60 * 1000),
    60_000
);

const CLEANUP_INTERVAL_MS = Math.max(
    Number(process.env.WHATSAPP_CLIENT_CLEANUP_INTERVAL_MS ?? 60_000),
    30_000
);

const puppeteerArgs = process.env.WHATSAPP_PUPPETEER_ARGS?.split(',')
    .map((arg) => arg.trim())
    .filter(Boolean) ?? [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
];

const contexts = new Map();

const cleanupTimer = setInterval(() => {
    void cleanupInactiveContexts();
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
}

function sanitizeSessionPart(value) {
    return String(value ?? 'session')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_');
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeUserId(userRef) {
    if (!userRef) {
        throw new Error('userRef es requerido');
    }

    if (typeof userRef === 'string') {
        return userRef;
    }

    if (typeof userRef === 'object') {
        if (userRef._id) return String(userRef._id);
        if (userRef.id) return String(userRef.id);
        if (userRef.userId) return String(userRef.userId);
    }

    throw new Error('No se pudo resolver el usuario de WhatsApp');
}

function resolveSessionId(userRef) {
    return `${SESSION_PREFIX}_${sanitizeSessionPart(normalizeUserId(userRef))}`;
}

function createInitialStatus(sessionId) {
    return {
        sessionId,
        state: 'idle',
        qr: null,
        lastQrAt: null,
        lastReadyAt: null,
        lastSessionPersistedAt: null,
        error: null,
        disconnectReason: null,
        engineState: null,
    };
}

function touchContext(context) {
    context.lastTouchedAt = Date.now();
}

function getOrCreateContext(userRef) {
    const userId = normalizeUserId(userRef);
    let context = contexts.get(userId);

    if (!context) {
        const sessionId = resolveSessionId(userId);
        context = {
            userId,
            sessionId,
            status: createInitialStatus(sessionId),
            emitter: new EventEmitter(),
            client: null,
            initPromise: null,
            backupPromise: null,
            lastTouchedAt: Date.now(),
        };
        contexts.set(userId, context);
    }

    touchContext(context);
    return context;
}

function emitStatus(context, update = {}) {
    Object.assign(context.status, update, { sessionId: context.sessionId });
    context.emitter.emit('status', getStatus(context.userId));
}

function getStatus(userRef) {
    const context = getOrCreateContext(userRef);
    return { ...context.status };
}

function isLogoutReason(reason) {
    return typeof reason === 'string' && reason.toLowerCase().includes('logout');
}

async function destroyClientContext(context, options = {}) {
    const { clearRemoteSession = false, deleteContext = false } = options;
    const clientToDestroy = context.client;

    context.client = null;
    context.initPromise = null;
    context.backupPromise = null;

    if (clientToDestroy) {
        try {
            await clientToDestroy.destroy();
        } catch (error) {
            console.error(`[WhatsApp] Error al destruir el cliente de ${context.userId}`, error);
        }
    }

    if (clearRemoteSession) {
        try {
            const store = new WhatsAppMongoStore(context.sessionId);
            await store.delete(context.sessionId);
        } catch (error) {
            console.error(`[WhatsApp] Error al limpiar la sesión remota de ${context.userId}`, error);
        }
    }

    if (deleteContext) {
        contexts.delete(context.userId);
    }
}

function attachClientHandlers(context, instance) {
    instance.on('qr', async (raw) => {
        if (context.client !== instance) return;

        try {
            const dataUrl = await qrcode.toDataURL(raw, { margin: 1 });
            emitStatus(context, {
                state: 'qr',
                qr: dataUrl,
                lastQrAt: nowIso(),
                error: null,
                disconnectReason: null,
            });
        } catch (error) {
            emitStatus(context, {
                state: 'error',
                error: error instanceof Error ? error.message : 'QR generation failed',
                qr: null,
            });
        }
    });

    instance.on('ready', () => {
        if (context.client !== instance) return;

        emitStatus(context, {
            state: 'ready',
            qr: null,
            lastReadyAt: nowIso(),
            error: null,
            disconnectReason: null,
        });
        triggerRemoteBackup(context, 'ready');
    });

    instance.on('remote_session_saved', () => {
        if (context.client !== instance) return;
        emitStatus(context, {
            lastSessionPersistedAt: nowIso(),
            error: null,
        });
        context.backupPromise = null;
    });

    instance.on('auth_failure', (message) => {
        if (context.client !== instance) return;

        emitStatus(context, {
            state: 'error',
            error: message || 'Authentication failed',
            qr: null,
            disconnectReason: 'auth_failure',
        });

        void destroyClientContext(context, { clearRemoteSession: true });
    });

    instance.on('change_state', (engineState) => {
        if (context.client !== instance) return;
        emitStatus(context, { engineState });
    });

    instance.on('disconnected', (reason) => {
        if (context.client !== instance) return;

        const normalizedReason = reason ? String(reason) : null;
        emitStatus(context, {
            state: 'disconnected',
            disconnectReason: normalizedReason,
            qr: null,
            error: null,
        });

        void destroyClientContext(context, {
            clearRemoteSession: isLogoutReason(normalizedReason),
        });
    });
}

function createClient(context) {
    const store = new WhatsAppMongoStore(context.sessionId);
    const instance = new Client({
        authStrategy: new RemoteAuth({
            clientId: context.sessionId,
            store,
            backupSyncIntervalMs: Number(
                process.env.WHATSAPP_BACKUP_INTERVAL_MS ?? 60_000
            ),
        }),
        puppeteer: {
            headless: true,
            args: puppeteerArgs,
        },
        qrMaxRetries: Number(process.env.WHATSAPP_QR_MAX_RETRIES ?? 8),
    });

    context.client = instance;
    emitStatus(context, {
        state: 'initializing',
        error: null,
        disconnectReason: null,
        qr: null,
    });

    attachClientHandlers(context, instance);

    instance.initialize().catch((error) => {
        if (context.client !== instance) return;

        emitStatus(context, {
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
            qr: null,
        });

        void destroyClientContext(context);
    });

    return instance;
}

function ensureClient(userRef) {
    const context = getOrCreateContext(userRef);
    if (context.client) {
        return Promise.resolve(context.client);
    }
    if (context.initPromise) {
        return context.initPromise;
    }

    context.initPromise = Promise.resolve(createClient(context))
        .finally(() => {
            context.initPromise = null;
        });

    return context.initPromise;
}

function triggerRemoteBackup(context, reason) {
    const strategy = context.client?.authStrategy;
    if (!strategy || typeof strategy.storeRemoteSession !== 'function') {
        return;
    }
    if (context.backupPromise) {
        return context.backupPromise;
    }

    context.backupPromise = strategy.storeRemoteSession({ emit: true })
        .catch((error) => {
            console.error(
                `[WhatsApp] Error al forzar el respaldo remoto (${reason}) para ${context.userId}`,
                error
            );
        })
        .finally(() => {
            context.backupPromise = null;
        });

    return context.backupPromise;
}

async function requireReadyClient(userRef) {
    const context = getOrCreateContext(userRef);
    const instance = await ensureClient(context.userId);
    const current = getStatus(context.userId);

    if (current.state !== 'ready') {
        const error = new Error('WhatsApp client is not ready');
        error.code = 'CLIENT_NOT_READY';
        error.status = 409;
        throw error;
    }

    return instance;
}

async function resolveChat(instance, chatId) {
    try {
        return await instance.getChatById(chatId);
    } catch (_error) {
        const chats = await instance.getChats();
        const fallback = chats.find((chat) => normalizeChatId(chat.id) === chatId);
        if (fallback) return fallback;

        const error = new Error('Chat no encontrado');
        error.status = 404;
        throw error;
    }
}

async function fetchConversations(userRef, limit = 8, options = {}) {
    const { includeGroups = true } = options;
    const instance = await requireReadyClient(userRef);
    const chats = await instance.getChats();

    const filtered = chats
        .filter((chat) => !chat.isReadOnly)
        .filter((chat) => (includeGroups ? true : !chat.isGroup))
        .filter((chat) => Boolean(normalizeChatId(chat.id)));

    const sorted = filtered
        .sort(
            (a, b) =>
                (b.timestamp ?? b.lastMessage?.timestamp ?? 0) -
                (a.timestamp ?? a.lastMessage?.timestamp ?? 0)
        )
        .slice(0, limit);

    return sorted.map((chat) => {
        const lastMessage = chat.lastMessage
            ? {
                id: normalizeMessageId(chat.lastMessage.id),
                body: chat.lastMessage.body ?? '',
                fromMe: Boolean(chat.lastMessage.fromMe),
                timestamp: normalizeTimestamp(chat.lastMessage.timestamp),
                author: chat.lastMessage.author ?? null,
                type: chat.lastMessage.type ?? null,
            }
            : null;

        return {
            id: normalizeChatId(chat.id),
            name:
                chat.name ||
                chat.pushname ||
                chat.formattedTitle ||
                chat.id?.user ||
                'Chat',
            isGroup: Boolean(chat.isGroup),
            unreadCount: chat.unreadCount ?? 0,
            lastMessage,
            muted: chat.isMuted ?? false,
        };
    });
}

async function fetchMessages(userRef, chatId, limit = 20) {
    if (!chatId) {
        const error = new Error('chatId requerido');
        error.status = 400;
        throw error;
    }

    const instance = await requireReadyClient(userRef);
    const chat = await resolveChat(instance, chatId);
    const messages = await chat.fetchMessages({ limit });

    return {
        chat: {
            id: normalizeChatId(chat.id),
            name:
                chat.name ||
                chat.pushname ||
                chat.formattedTitle ||
                chat.id?.user ||
                'Chat',
            isGroup: Boolean(chat.isGroup),
        },
        messages: messages
            .map((message) => ({
                id: normalizeMessageId(message.id),
                body: message.body ?? '',
                fromMe: Boolean(message.fromMe),
                timestamp: normalizeTimestamp(message.timestamp),
                type: message.type ?? null,
                author: message.author ?? null,
                ack: message.ack ?? null,
            }))
            .sort(
                (a, b) =>
                    new Date(a.timestamp ?? 0).getTime() -
                    new Date(b.timestamp ?? 0).getTime()
            ),
    };
}

async function cleanupInactiveContexts() {
    const now = Date.now();
    const pending = [];

    for (const [userId, context] of contexts.entries()) {
        const idleTime = now - context.lastTouchedAt;
        if (idleTime < CLIENT_IDLE_TTL_MS) {
            continue;
        }

        if (context.initPromise) {
            continue;
        }

        pending.push(
            destroyClientContext(context, { deleteContext: true }).catch((error) => {
                console.error(`[WhatsApp] Error limpiando el contexto inactivo de ${userId}`, error);
            })
        );
    }

    if (pending.length) {
        await Promise.allSettled(pending);
    }
}

function normalizeChatId(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw._serialized) return raw._serialized;
    if (typeof raw === 'object' && raw.user && raw.server) {
        return `${raw.user}@${raw.server}`;
    }
    return String(raw ?? '');
}

function normalizeMessageId(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw._serialized) return raw._serialized;
    return String(raw ?? '');
}

function normalizeTimestamp(value) {
    if (!value) return null;
    const ts = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ts)) return null;
    const millis = ts > 1e12 ? ts : ts * 1000;
    return new Date(millis).toISOString();
}

module.exports = {
    ensureClient,
    getStatus,
    onStatus: (userRef, listener) => {
        const context = getOrCreateContext(userRef);
        context.emitter.on('status', listener);
        return () => context.emitter.off('status', listener);
    },
    fetchConversations,
    fetchMessages,
};
