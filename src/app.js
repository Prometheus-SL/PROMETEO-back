const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Si estamos detrás de un proxy (Traefik/Nginx), habilitar trust proxy si se indica
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// Middleware de seguridad
app.use(helmet());

// Middleware de compresión
app.use(compression());

// Middleware de logs
app.use(morgan('combined'));

// Utilidad para leer lista de orígenes permitidos (coma) o regex entre /.../
const parseOrigins = (value) => {
    if (!value) return ['http://localhost:3001'];
    return value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
};

const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || process.env.CLIENT_URL);
const allowCredentials = String(process.env.CORS_CREDENTIALS).toLowerCase() === 'true';

const isOriginAllowed = (origin) => {
    if (!origin) return true; // permitir herramientas/no navegador y same-origin
    if (allowedOrigins.includes(origin)) return true;
    // Soportar patrones regex escritos como /regex/
    return allowedOrigins.some(o => {
        if (o.startsWith('/') && o.endsWith('/')) {
            try {
                const re = new RegExp(o.slice(1, -1));
                return re.test(origin);
            } catch (_) {
                return false;
            }
        }
        return false;
    });
};

    const corsOptions = {
        origin: (origin, callback) => {
            const allowed = isOriginAllowed(origin);
            if (!allowed) {
                // Log mínimo para diagnosticar orígenes bloqueados en producción
                console.warn(`[CORS] Origen bloqueado: ${origin || 'sin-origin'} | permitidos: ${allowedOrigins.join(', ')}`);
            }
            callback(null, allowed);
        },
    credentials: allowCredentials,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // allowedHeaders undefined => se reflejan los enviados en Access-Control-Request-Headers
        optionsSuccessStatus: 204,
        preflightContinue: false
};

// Middleware de CORS (colocado pronto para que el preflight no lo bloquee nada)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

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
const dashboardRoutes = require('./routes/dashboard');

// Middleware de logging personalizado
app.use(customLogger);

// Configurar rutas
app.use('/api/v1', apiRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
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