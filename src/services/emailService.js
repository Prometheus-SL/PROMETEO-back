const crypto = require('crypto');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function isEmailServiceAvailable() {
    return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL);
}

function getBrevoSender() {
    const email = String(process.env.BREVO_FROM_EMAIL || '').trim();
    if (!email) {
        throw new Error('BREVO_FROM_EMAIL must be configured with a verified Brevo sender');
    }

    return {
        email,
        name: process.env.BREVO_FROM_NAME || 'Prometeo',
    };
}

function getFrontendUrl() {
    return String(process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
}

function normalizeRecipient(recipient) {
    if (typeof recipient === 'string') {
        const email = recipient.trim();
        if (!email) {
            throw new Error('Email recipient is missing an email address');
        }
        return { email };
    }

    if (recipient && typeof recipient === 'object') {
        const email = String(recipient.email || '').trim();
        if (!email) {
            throw new Error('Email recipient is missing an email address');
        }

        return {
            email,
            ...(recipient.name ? { name: String(recipient.name) } : {}),
        };
    }

    throw new Error('Email recipient is required');
}

function buildBrevoPayload({ to, subject, html, tags = [] }) {
    const recipients = (Array.isArray(to) ? to : [to]).map(normalizeRecipient);
    if (recipients.length === 0) {
        throw new Error('At least one email recipient is required');
    }

    return {
        sender: getBrevoSender(),
        subject,
        htmlContent: html,
        ...(tags.length ? { tags } : {}),
        messageVersions: [
            {
                to: recipients,
            },
        ],
    };
}

async function parseBrevoResponse(response) {
    const text = await response.text().catch(() => '');
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (_error) {
        return text;
    }
}

async function sendEmail({ to, subject, html }) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.warn('[EmailService] BREVO_API_KEY not configured - email not sent to', to);
        return { accepted: false, skipped: true, reason: 'BREVO_API_KEY_MISSING' };
    }

    const payload = buildBrevoPayload({
        to,
        subject,
        html,
        tags: ['prometeo-auth'],
    });

    const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const responseBody = await parseBrevoResponse(response);

    if (!response.ok) {
        const errorText = typeof responseBody === 'string'
            ? responseBody
            : JSON.stringify(responseBody || {});
        throw new Error(`Brevo API error ${response.status}: ${errorText}`);
    }

    const messageIds = Array.isArray(responseBody?.messageIds)
        ? responseBody.messageIds
        : responseBody?.messageId
            ? [responseBody.messageId]
            : [];

    return {
        accepted: true,
        messageId: responseBody?.messageId || null,
        messageIds,
    };
}

async function sendVerificationEmail(email, token) {
    const baseUrl = getFrontendUrl();
    const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

    return sendEmail({
        to: email,
        subject: 'Verify your Prometeo account',
        html: `
            <h2>Welcome to Prometeo</h2>
            <p>Click the link below to verify your email address:</p>
            <p><a href="${verifyUrl}">Verify my email</a></p>
            <p>This link expires in 24 hours.</p>
            <p>If you didn't create this account, you can ignore this email.</p>
        `,
    });
}

async function sendPasswordResetEmail(email, token) {
    const baseUrl = getFrontendUrl();
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    return sendEmail({
        to: email,
        subject: 'Reset your Prometeo password',
        html: `
            <h2>Password Reset</h2>
            <p>Click the link below to reset your password:</p>
            <p><a href="${resetUrl}">Reset my password</a></p>
            <p>This link expires in 1 hour.</p>
            <p>If you didn't request this, you can ignore this email.</p>
        `,
    });
}

module.exports = {
    isEmailServiceAvailable,
    generateSecureToken,
    hashToken,
    sendVerificationEmail,
    sendPasswordResetEmail,
};
