const assert = require('node:assert/strict');
const test = require('node:test');

const emailService = require('../src/services/emailService');

function withEnv(env, fn) {
    const previous = {};
    for (const key of Object.keys(env)) {
        previous[key] = process.env[key];
        process.env[key] = env[key];
    }

    return Promise.resolve()
        .then(fn)
        .finally(() => {
            for (const key of Object.keys(env)) {
                if (previous[key] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[key];
                }
            }
        });
}

test('sendVerificationEmail uses Brevo batch messageVersions payload without root recipients', async () => {
    let capturedRequest = null;
    const previousFetch = global.fetch;
    global.fetch = async (url, options) => {
        capturedRequest = {
            url,
            options,
            body: JSON.parse(options.body),
        };
        return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            async json() {
                return { messageIds: ['message-1@smtp-relay.mailin.fr'] };
            },
            async text() {
                return JSON.stringify({ messageIds: ['message-1@smtp-relay.mailin.fr'] });
            },
        };
    };

    try {
        await withEnv({
            BREVO_API_KEY: 'xkeysib-test',
            BREVO_FROM_EMAIL: 'sender@example.com',
            BREVO_FROM_NAME: 'Prometeo',
            FRONTEND_URL: 'https://app.example.com',
        }, async () => {
            const result = await emailService.sendVerificationEmail('mike@example.com', 'token-123');

            assert.equal(result.accepted, true);
            assert.deepEqual(result.messageIds, ['message-1@smtp-relay.mailin.fr']);
            assert.equal(capturedRequest.url, 'https://api.brevo.com/v3/smtp/email');
            assert.equal(capturedRequest.options.headers['api-key'], 'xkeysib-test');
            assert.equal(capturedRequest.body.to, undefined);
            assert.equal(capturedRequest.body.messageVersions.length, 1);
            assert.deepEqual(capturedRequest.body.messageVersions[0].to, [
                { email: 'mike@example.com' },
            ]);
            assert.match(capturedRequest.body.htmlContent, /https:\/\/app\.example\.com\/verify-email\?token=token-123/);
        });
    } finally {
        global.fetch = previousFetch;
    }
});
