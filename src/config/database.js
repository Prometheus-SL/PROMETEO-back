const mongoose = require('mongoose');

// Configuración de conexión a MongoDB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);

        console.log(`📊 MongoDB conectado: ${conn.connection.host}`);

        // Eliminamos índice TTL heredado que borraba usuarios por refreshTokens.createdAt
        try {
            const collection = mongoose.connection.db.collection('users');
            const indexes = await collection.indexes();
            const ttlIndex = indexes.find(idx => idx.name === 'refreshTokens.createdAt_1');
            if (ttlIndex) {
                await collection.dropIndex(ttlIndex.name);
                console.log('🧹 Índice TTL refreshTokens.createdAt eliminado');
            }
        } catch (cleanupErr) {
            console.warn('No se pudo revisar/eliminar índice TTL de usuarios:', cleanupErr.message);
        }

        // Eventos de conexión
        mongoose.connection.on('error', (err) => {
            console.error('❌ Error de MongoDB:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('🔌 MongoDB desconectado');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('🔄 MongoDB reconectado');
        });

    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        process.exit(1);
    }
};

// Manejo de cierre graceful
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('🔒 Conexión MongoDB cerrada por terminación de app');
    process.exit(0);
});

module.exports = connectDB;