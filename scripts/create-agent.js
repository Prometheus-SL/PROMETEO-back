const mongoose = require('mongoose');
const crypto = require('crypto');
const Agent = require('../src/models/Agent');
const { hashApiKey } = require('../src/services/agentApiKey');
require('dotenv').config();

const createExampleAgent = async () => {
    try {
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('📊 Conectado a MongoDB');

        // Generar API Key única
        const apiKey = crypto.randomBytes(32).toString('hex');

        // Crear agente de ejemplo
        const exampleAgent = new Agent({
            agentId: 'sensor-001',
            name: 'Sensor de Temperatura Principal',
            description: 'Sensor de temperatura y humedad ubicado en el laboratorio principal',
            apiKey: hashApiKey(apiKey),
            location: {
                name: 'Laboratorio Principal',
                coordinates: {
                    latitude: 40.4168,
                    longitude: -3.7038
                }
            },
            status: 'active',
            metadata: new Map([
                ['type', 'temperature_humidity'],
                ['model', 'DHT22'],
                ['version', '1.0.0']
            ])
        });

        await exampleAgent.save();

        console.log('🎉 Agente de ejemplo creado exitosamente!');
        console.log('🆔 Agent ID:', exampleAgent.agentId);
        console.log('🔑 API Key:', apiKey);
        console.log('📍 Ubicación:', exampleAgent.location.name);
        console.log('⚠️  Guarda la API Key, no se mostrará de nuevo');

        // Crear otro agente
        const apiKey2 = crypto.randomBytes(32).toString('hex');
        const agent2 = new Agent({
            agentId: 'sensor-002',
            name: 'Sensor de Presión Atmosférica',
            description: 'Sensor de presión atmosférica en la estación meteorológica',
            apiKey: hashApiKey(apiKey2),
            location: {
                name: 'Estación Meteorológica',
                coordinates: {
                    latitude: 40.4200,
                    longitude: -3.7100
                }
            },
            status: 'active',
            metadata: new Map([
                ['type', 'pressure'],
                ['model', 'BMP280'],
                ['version', '1.0.0']
            ])
        });

        await agent2.save();
        console.log('\n🎉 Segundo agente creado exitosamente!');
        console.log('🆔 Agent ID:', agent2.agentId);
        console.log('🔑 API Key:', apiKey2);
        console.log('📍 Ubicación:', agent2.location.name);

    } catch (error) {
        console.error('❌ Error creando agente:', error);
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
};

createExampleAgent();