const mongoose = require('mongoose');

// Configuración de conexión a MongoDB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);

        console.log(`📊 MongoDB conectado: ${conn.connection.host}`);

        // Eliminamos índices TTL heredados que borraban usuarios (p. ej. refreshTokens.createdAt)
        try {
            const collection = mongoose.connection.db.collection('users');
            const indexes = await collection.indexes();
            const ttlIndexes = indexes.filter(idx => typeof idx.expireAfterSeconds === 'number');
            if (ttlIndexes.length > 0) {
                await Promise.all(ttlIndexes.map(idx => collection.dropIndex(idx.name)));
                console.log(`🧹 Índices TTL de usuarios eliminados: ${ttlIndexes.map(idx => idx.name).join(', ')}`);
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