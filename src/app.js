const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de seguridad
app.use(helmet());

// Middleware de compresión
app.use(compression());

// Middleware de logs
app.use(morgan('combined'));

// Middleware de CORS
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3001',
    credentials: true
}));

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta básica de salud
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'Servidor PROMETEO funcionando correctamente',
        timestamp: new Date().toISOString()
    });
});

// Importar rutas y middleware
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const controlRoutes = require('./routes/control');
const { errorHandler, customLogger } = require('./middleware/errorHandler');

// Middleware de logging personalizado
app.use(customLogger);

// Configurar rutas
app.use('/api/v1', apiRoutes);
app.use('/auth', authRoutes);
app.use('/control', controlRoutes);

// Ruta de bienvenida
app.get('/', (req, res) => {
    res.json({
        message: 'Bienvenido al Backend de PROMETEO',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            api: '/api/v1',
            websocket: 'ws://localhost:' + (process.env.PORT || 3000)
        }
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

module.exports = app;