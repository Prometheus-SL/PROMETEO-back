const assert = require('node:assert/strict');
const test = require('node:test');

function loadGroqClient() {
    delete require.cache[require.resolve('../src/services/spark/groqClient')];
    return require('../src/services/spark/groqClient');
}

test('createChatCompletion sends a timeout signal to Groq fetches', async (t) => {
    const previousApiKey = process.env.GROQ_API_KEY;
    const previousTimeout = process.env.GROQ_CHAT_TIMEOUT_MS;
    process.env.GROQ_API_KEY = 'groq-test-key';
    process.env.GROQ_CHAT_TIMEOUT_MS = '12345';
    t.after(() => {
        if (previousApiKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = previousApiKey;
        if (previousTimeout === undefined) delete process.env.GROQ_CHAT_TIMEOUT_MS;
        else process.env.GROQ_CHAT_TIMEOUT_MS = previousTimeout;
        delete require.cache[require.resolve('../src/services/spark/groqClient')];
    });

    let receivedSignal = null;
    const originalFetch = global.fetch;
    global.fetch = async (_url, init = {}) => {
        receivedSignal = init.signal;
        return new Response(JSON.stringify({ choices: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    const groqClient = loadGroqClient();
    await groqClient.createChatCompletion({ messages: [] });

    assert.ok(receivedSignal);
});

test('transcribeAudio sends a timeout signal to Groq fetches', async (t) => {
    const previousApiKey = process.env.GROQ_API_KEY;
    const previousTimeout = process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS;
    process.env.GROQ_API_KEY = 'groq-test-key';
    process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS = '23456';
    t.after(() => {
        if (previousApiKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = previousApiKey;
        if (previousTimeout === undefined) delete process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS;
        else process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS = previousTimeout;
        delete require.cache[require.resolve('../src/services/spark/groqClient')];
    });

    let receivedSignal = null;
    const originalFetch = global.fetch;
    global.fetch = async (_url, init = {}) => {
        receivedSignal = init.signal;
        return new Response(JSON.stringify({ text: 'apaga las luces' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    const groqClient = loadGroqClient();
    const text = await groqClient.transcribeAudio({
        buffer: Buffer.from('audio'),
        mimetype: 'audio/webm',
        originalname: 'speech.webm',
    });

    assert.equal(text, 'apaga las luces');
    assert.ok(receivedSignal);
});
