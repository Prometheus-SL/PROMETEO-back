const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const mock = require('mock-require');

const clientPath = path.join(
    __dirname,
    '..',
    'src',
    'services',
    'whatsapp',
    'client.js'
);
const storePath = path.join(
    __dirname,
    '..',
    'src',
    'services',
    'whatsapp',
    'store.js'
);

function resetModule() {
    try {
        delete require.cache[require.resolve(clientPath)];
    } catch (_error) {
        // Ignore cache misses between tests.
    }
}

test('sendMessage normalizes the message id and timestamp returned by whatsapp-web.js', async (t) => {
    const calls = [];

    class FakeClient {
        constructor() {
            this.handlers = new Map();
        }

        on(event, handler) {
            this.handlers.set(event, handler);
        }

        initialize() {
            queueMicrotask(() => {
                this.handlers.get('ready')?.();
            });
            return Promise.resolve();
        }

        async sendMessage(chatId, text) {
            calls.push({ chatId, text });
            return {
                id: { _serialized: 'wamid.msg-123' },
                timestamp: 1710000000,
            };
        }

        async destroy() {}
    }

    class FakeRemoteAuth {
        constructor(options) {
            this.options = options;
        }
    }

    mock('qrcode', {
        toDataURL: async () => 'data:image/png;base64,qr',
    });
    mock('whatsapp-web.js', {
        Client: FakeClient,
        RemoteAuth: FakeRemoteAuth,
    });
    mock(storePath, {
        WhatsAppMongoStore: class FakeStore {
            async delete() {}
        },
    });

    resetModule();
    const whatsappClient = require(clientPath);

    t.after(() => {
        mock.stopAll();
        resetModule();
    });

    const result = await whatsappClient.sendMessage(
        { _id: 'user-1' },
        '34600111222@c.us',
        'Hola'
    );

    assert.deepEqual(calls, [
        {
            chatId: '34600111222@c.us',
            text: 'Hola',
        },
    ]);
    assert.deepEqual(result, {
        id: 'wamid.msg-123',
        timestamp: '2024-03-09T16:00:00.000Z',
    });
});
