const assert = require('node:assert/strict');
const test = require('node:test');

process.env.LINKED_ACCOUNTS_ENCRYPTION_KEY = process.env.LINKED_ACCOUNTS_ENCRYPTION_KEY || 'test-mask-key';

const DashboardPage = require('../src/models/DashboardPage');
const { encryptConfigSecrets, SECRET_MASK } = require('../src/services/moduleSecrets');

test('serialized dashboard page masks module config secrets but keeps them encrypted at rest', () => {
    const encryptedConfig = encryptConfigSecrets('lifx-widget', { apiToken: 'tok-xyz', refreshInterval: 5 });
    const page = new DashboardPage({
        user: '507f1f77bcf86cd799439011',
        name: 'Home',
        slug: 'home',
        modules: [
            { meta: { id: 'lifx-widget', name: 'LIFX', entry: './index.tsx' }, config: encryptedConfig },
        ],
    });

    // Respuesta de página: el secreto va enmascarado.
    const json = page.toJSON();
    assert.equal(json.modules[0].config.apiToken, SECRET_MASK);
    assert.equal(json.modules[0].config.refreshInterval, 5);

    // El subdoc suelto (respuestas de POST/PATCH del módulo) también se enmascara.
    assert.equal(page.modules[0].toJSON().config.apiToken, SECRET_MASK);

    // Acceso directo (lo que usa el driver): conserva el valor cifrado, no el plano.
    assert.equal(typeof page.modules[0].config.apiToken.ciphertext, 'string');
});
