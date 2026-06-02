// Migra las apiKey de agentes que estén en claro a su hash (`v2$...`). Idempotente:
// las que ya están hasheadas se ignoran. Las claves en claro existentes siguen siendo
// válidas tras la migración (el middleware hashea la entrante y la compara).
const mongoose = require('mongoose');
const Agent = require('../src/models/Agent');
const { hashApiKey, isHashedApiKey } = require('../src/services/agentApiKey');
require('dotenv').config();

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const agents = await Agent.find({}).select('+apiKey');

        let migrated = 0;
        for (const agent of agents) {
            if (agent.apiKey && !isHashedApiKey(agent.apiKey)) {
                agent.apiKey = hashApiKey(agent.apiKey);
                await agent.save();
                migrated += 1;
            }
        }

        console.log(`Migradas ${migrated} de ${agents.length} apiKeys de agente a hash.`);
    } catch (error) {
        console.error('Error migrando apiKeys de agente:', error);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
        process.exit(process.exitCode || 0);
    }
})();
