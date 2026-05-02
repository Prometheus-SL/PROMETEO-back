const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const { fetchWithTimeout, readTimeoutMs } = require('./fetchWithTimeout');

const DEFAULT_GROQ_CHAT_TIMEOUT_MS = 25_000;
const DEFAULT_GROQ_TRANSCRIPTION_TIMEOUT_MS = 45_000;

function getApiKey() {
    const apiKey = String(process.env.GROQ_API_KEY || '').trim();
    if (!apiKey) {
        const error = new Error('GROQ_API_KEY is not configured');
        error.code = 'GROQ_API_KEY_MISSING';
        throw error;
    }

    return apiKey;
}

async function readGroqError(response) {
    const text = await response.text().catch(() => '');
    if (!text) return `${response.status} ${response.statusText}`;

    try {
        const data = JSON.parse(text);
        return data?.error?.message || data?.message || text;
    } catch (_error) {
        return text;
    }
}

async function createChatCompletion(payload) {
    const response = await fetchWithTimeout(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
            model: process.env.GROQ_CHAT_MODEL || 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_completion_tokens: 260,
            parallel_tool_calls: true,
            ...payload,
        }),
    }, readTimeoutMs(process.env.GROQ_CHAT_TIMEOUT_MS, DEFAULT_GROQ_CHAT_TIMEOUT_MS), 'Groq chat');

    if (!response.ok) {
        throw new Error(`Groq chat error: ${await readGroqError(response)}`);
    }

    return response.json();
}

async function transcribeAudio({ buffer, mimetype, originalname }) {
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimetype || 'audio/webm' });

    formData.append('file', blob, originalname || 'speech.webm');
    formData.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3');
    formData.append('language', 'es');
    formData.append('response_format', 'json');
    formData.append('temperature', '0');

    const response = await fetchWithTimeout(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${getApiKey()}`,
        },
        body: formData,
    }, readTimeoutMs(process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS, DEFAULT_GROQ_TRANSCRIPTION_TIMEOUT_MS), 'Groq transcription');

    if (!response.ok) {
        throw new Error(`Groq transcription error: ${await readGroqError(response)}`);
    }

    const data = await response.json();
    return String(data?.text || '').trim();
}

module.exports = {
    createChatCompletion,
    transcribeAudio,
};
