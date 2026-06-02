const {
    encryptLinkedAccountPayload,
    decryptLinkedAccountPayload,
} = require('./linkedAccounts');

// Campos de `config` de un módulo que son secretos: se cifran en reposo y NO se
// devuelven en claro al cliente. Indexado por meta.id del módulo.
const SECRET_CONFIG_FIELDS = {
    'lifx-widget': ['apiToken'],
};

// Placeholder que ve el cliente en lugar del secreto. Es una cadena no vacía (pasa la
// validación del front) y, si vuelve tal cual en un PATCH, significa "no cambiar".
const SECRET_MASK = '••••••••';

function secretFieldsFor(metaId) {
    return SECRET_CONFIG_FIELDS[String(metaId || '')] || [];
}

function isEncryptionConfigured() {
    return Boolean(String(process.env.LINKED_ACCOUNTS_ENCRYPTION_KEY || '').trim());
}

function isEncryptedSecret(value) {
    return Boolean(
        value
        && typeof value === 'object'
        && typeof value.ciphertext === 'string'
        && typeof value.iv === 'string'
        && typeof value.tag === 'string'
    );
}

// Al guardar: cifra los campos secretos. `existingConfig` conserva (y migra a cifrado) el
// valor previo cuando el cliente reenvía el placeholder (edición sin tocar el secreto).
function encryptConfigSecrets(metaId, config, existingConfig = {}) {
    const fields = secretFieldsFor(metaId);
    if (!fields.length || !config || typeof config !== 'object') {
        return config;
    }

    const next = { ...config };
    for (const field of fields) {
        const value = next[field];

        if (value === SECRET_MASK) {
            const existing = existingConfig ? existingConfig[field] : undefined;
            if (existing === undefined) {
                delete next[field];
            } else if (isEncryptedSecret(existing)) {
                next[field] = existing;
            } else if (typeof existing === 'string' && existing.trim() && isEncryptionConfigured()) {
                next[field] = encryptLinkedAccountPayload(existing);
            } else {
                next[field] = existing;
            }
            continue;
        }

        if (isEncryptedSecret(value)) {
            continue;
        }

        if (typeof value === 'string' && value.trim() && isEncryptionConfigured()) {
            next[field] = encryptLinkedAccountPayload(value);
        }
    }

    return next;
}

// Para uso server-side (drivers): descifra los campos secretos a texto plano.
function decryptConfigSecrets(metaId, config) {
    const fields = secretFieldsFor(metaId);
    if (!fields.length || !config || typeof config !== 'object') {
        return config;
    }

    let next = config;
    for (const field of fields) {
        if (isEncryptedSecret(config[field])) {
            if (next === config) {
                next = { ...config };
            }
            try {
                next[field] = decryptLinkedAccountPayload(config[field]);
            } catch (_error) {
                next[field] = '';
            }
        }
    }

    return next;
}

// Para enviar al cliente: sustituye los campos secretos con valor por el placeholder.
function maskConfigSecrets(metaId, config) {
    const fields = secretFieldsFor(metaId);
    if (!fields.length || !config || typeof config !== 'object') {
        return config;
    }

    let next = config;
    for (const field of fields) {
        const value = config[field];
        if (value !== undefined && value !== null && value !== '') {
            if (next === config) {
                next = { ...config };
            }
            next[field] = SECRET_MASK;
        }
    }

    return next;
}

module.exports = {
    SECRET_CONFIG_FIELDS,
    SECRET_MASK,
    encryptConfigSecrets,
    decryptConfigSecrets,
    maskConfigSecrets,
    isEncryptedSecret,
};
