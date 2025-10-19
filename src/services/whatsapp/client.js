const EventEmitter = require('events');
const qrcode = require('qrcode');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { WhatsAppMongoStore } = require('./store');

const sessionId = process.env.WHATSAPP_SESSION_ID || 'personal-whatsapp';
const puppeteerArgs = process.env.WHATSAPP_PUPPETEER_ARGS?.split(',').map((arg) => arg.trim()).filter(Boolean) ?? [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
];

const status = {
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

const emitter = new EventEmitter();
let client = null;
let initPromise = null;
let backupPromise = null;

function emitStatus(update = {}) {
    Object.assign(status, update);
    emitter.emit('status', getStatus());
}

function getStatus() {
    return { ...status };
}

function ensureClient() {
    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        const store = new WhatsAppMongoStore(sessionId);

        client = new Client({
            authStrategy: new RemoteAuth({
                store,
                backupSyncIntervalMs: Number(process.env.WHATSAPP_BACKUP_INTERVAL_MS ?? 60000),
            }),
            puppeteer: {
                headless: true,
                args: puppeteerArgs,
            },
            qrMaxRetries: Number(process.env.WHATSAPP_QR_MAX_RETRIES ?? 8),
        });

        emitStatus({ state: 'initializing', error: null, disconnectReason: null });

        client.on('qr', async (raw) => {
            try {
                const dataUrl = await qrcode.toDataURL(raw, { margin: 1 });
                emitStatus({
                    state: 'qr',
                    qr: dataUrl,
                    lastQrAt: new Date().toISOString(),
                });
            } catch (error) {
                emitStatus({
                    state: 'error',
                    error: error instanceof Error ? error.message : 'QR generation failed',
                });
            }
        });

        client.on('ready', () => {
            emitStatus({
                state: 'ready',
                qr: null,
                lastReadyAt: new Date().toISOString(),
                error: null,
            });
            triggerRemoteBackup('ready');
        });

        client.on('remote_session_saved', () => {
            emitStatus({ lastSessionPersistedAt: new Date().toISOString() });
            backupPromise = null;
        });

        client.on('auth_failure', (message) => {
            emitStatus({ state: 'error', error: message || 'Autenticación fallida', qr: null });
        });

        client.on('change_state', (engineState) => {
            emitStatus({ engineState });
        });

        client.on('disconnected', (reason) => {
            emitStatus({ state: 'disconnected', disconnectReason: reason ?? null, qr: null });
            // Intento automático de reconexión
            setTimeout(() => {
                if (!client) return;
                emitStatus({ state: 'initializing', error: null });
                client.initialize().catch((error) => {
                    emitStatus({ state: 'error', error: error instanceof Error ? error.message : String(error) });
                });
            }, Number(process.env.WHATSAPP_RECONNECT_DELAY_MS ?? 5000));
        });

        client.initialize().catch((error) => {
            emitStatus({ state: 'error', error: error instanceof Error ? error.message : String(error) });
        });

        return client;
    })();

    return initPromise;
}

function triggerRemoteBackup(reason) {
    const strategy = client?.authStrategy;
    if (!strategy || typeof strategy.storeRemoteSession !== 'function') {
        return;
    }
    if (backupPromise) {
        return backupPromise;
    }
    backupPromise = strategy.storeRemoteSession({ emit: true })
        .catch((error) => {
            console.error(`[WhatsApp] Error al forzar el respaldo remoto (${reason})`, error);
        })
        .finally(() => {
            backupPromise = null;
        });
    return backupPromise;
}

async function requireReadyClient() {
    const instance = await ensureClient();
    const current = getStatus();
    if (current.state !== 'ready') {
        const err = new Error('WhatsApp client is not ready');
        err.code = 'CLIENT_NOT_READY';
        err.status = 409;
        throw err;
    }
    return instance;
}

async function fetchConversations(limit = 8, options = {}) {
    const { includeGroups = true } = options;
    const instance = await requireReadyClient();
    const chats = await instance.getChats();

    const filtered = chats
        .filter((chat) => !chat.isReadOnly)
        .filter((chat) => (includeGroups ? true : !chat.isGroup))
        .filter((chat) => Boolean(normalizeChatId(chat.id)));

    const sorted = filtered
        .sort((a, b) => (b.timestamp ?? b.lastMessage?.timestamp ?? 0) - (a.timestamp ?? a.lastMessage?.timestamp ?? 0))
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
            name: chat.name || chat.pushname || chat.formattedTitle || chat.id?.user || 'Chat',
            isGroup: Boolean(chat.isGroup),
            unreadCount: chat.unreadCount ?? 0,
            lastMessage,
            muted: chat.isMuted ?? false,
        };
    });
}

async function fetchMessages(chatId, limit = 20) {
    if (!chatId) {
        const err = new Error('chatId requerido');
        err.status = 400;
        throw err;
    }
    const instance = await requireReadyClient();
    const chat = await instance.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });

    return {
        chat: {
            id: normalizeChatId(chat.id),
            name: chat.name || chat.pushname || chat.formattedTitle || chat.id?.user || 'Chat',
            isGroup: Boolean(chat.isGroup),
        },
        messages: messages
            .map((m) => ({
                id: normalizeMessageId(m.id),
                body: m.body ?? '',
                fromMe: Boolean(m.fromMe),
                timestamp: normalizeTimestamp(m.timestamp),
                type: m.type ?? null,
                author: m.author ?? null,
                ack: m.ack ?? null,
            }))
            .sort((a, b) => new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime()),
    };
}

function normalizeChatId(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw._serialized) return raw._serialized;
    if (typeof raw === 'object' && raw.user && raw.server) return `${raw.user}@${raw.server}`;
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
    onStatus: (listener) => emitter.on('status', listener),
    fetchConversations,
    fetchMessages,
};
