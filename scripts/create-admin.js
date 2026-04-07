const mongoose = require('mongoose');
const User = require('../src/models/User');
require('dotenv').config();

const createAdminUser = async () => {
    try {
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('📊 Conectado a MongoDB');

        // Verificar si ya existe un admin
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) {
            console.log('✅ Ya existe un usuario administrador:', existingAdmin.username);
            process.exit(0);
        }

        // Crear usuario administrador
        const adminUser = new User({
            username: 'admin',
            email: 'admin@prometeo.com',
            password: 'admin123', // Se hashea automáticamente
            role: 'admin'
        });

        await adminUser.save();
        console.log('🎉 Usuario administrador creado exitosamente!');
        console.log('📧 Email: admin@prometeo.com');
        console.log('🔑 Password: admin123');
        console.log('⚠️  CAMBIAR LA CONTRASEÑA EN PRODUCCIÓN');

        // Crear usuario operador de ejemplo
        const operatorUser = new User({
            username: 'operator',
            email: 'operator@prometeo.com',
            password: 'operator123',
            role: 'operator'
        });

        await operatorUser.save();
        console.log('👤 Usuario operador creado exitosamente!');
        console.log('📧 Email: operator@prometeo.com');
        console.log('🔑 Password: operator123');

    } catch (error) {
        console.error('❌ Error creando usuarios:', error);
    } finally {
        mongoose.connection.close();
        process.exit(0);
    }
};

createAdminUser();