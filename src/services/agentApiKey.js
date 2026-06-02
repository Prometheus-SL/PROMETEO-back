const crypto = require('crypto');

// Hash con el que se guarda la apiKey del agente en reposo (la clave en claro solo se
// muestra una vez al crearse). El prefijo `v2$` distingue una clave hasheada de una
// legacy en claro, lo que permite migración perezosa y un script de migración.
function hashApiKey(plain) {
    return `v2$${crypto.createHash('sha256').update(String(plain)).digest('hex')}`;
}

function isHashedApiKey(value) {
    return typeof value === 'string' && value.startsWith('v2$');
}

module.exports = { hashApiKey, isHashedApiKey };
