const crypto = require('crypto');

const SECRET_LENGTH = 20;
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret() {
    const buffer = crypto.randomBytes(SECRET_LENGTH);
    return encodeBase32(buffer);
}

function encodeBase32(buffer) {
    let bits = '';
    for (const byte of buffer) {
        bits += byte.toString(2).padStart(8, '0');
    }
    let result = '';
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.substring(i, i + 5).padEnd(5, '0');
        result += BASE32_CHARS[parseInt(chunk, 2)];
    }
    return result;
}

function decodeBase32(encoded) {
    let bits = '';
    for (const char of encoded.toUpperCase()) {
        const val = BASE32_CHARS.indexOf(char);
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }
    return Buffer.from(bytes);
}

function generateTOTP(secret, time = Date.now(), step = 30) {
    const counter = Math.floor(time / 1000 / step);
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(0, 0);
    buffer.writeUInt32BE(counter, 4);

    const key = decodeBase32(secret);
    const hmac = crypto.createHmac('sha1', key).update(buffer).digest();

    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    ) % 1000000;

    return String(code).padStart(6, '0');
}

function verifyTOTP(secret, token, window = 1) {
    const now = Date.now();
    for (let i = -window; i <= window; i++) {
        const expected = generateTOTP(secret, now + i * 30000);
        if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
            return true;
        }
    }
    return false;
}

function buildOtpauthUri(secret, username, issuer = 'PROMETEO') {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function generateRecoveryCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
}

module.exports = { generateSecret, verifyTOTP, buildOtpauthUri, generateRecoveryCodes };
