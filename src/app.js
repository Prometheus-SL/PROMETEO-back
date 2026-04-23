const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { createExpressCorsOptions } = require('./config/cors');
const { ok } = require('./http/responses');

const app = express();

if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

app.use(helmet());
app.use(compression());
app.use(morgan('combined'));

const corsOptions = createExpressCorsOptions();
app.use(cors(corsOptions));
app.options('/{*any}', cors(corsOptions));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } },
    skip: (req) => req.path === '/health' || req.path === '/metrics',
});
app.use(globalLimiter);

const mongoose = require('mongoose');

app.get('/health', (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

    return ok(res, {
        status: dbState === 1 ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
        database: dbStatus,
    }, {
        message: dbState === 1 ? 'PROMETEO server is healthy' : 'PROMETEO server is degraded',
    });
});

const requestMetrics = { totalRequests: 0, errors: 0, statusCodes: {} };
app.use((req, res, next) => {
    requestMetrics.totalRequests++;
    res.on('finish', () => {
        const code = res.statusCode;
        requestMetrics.statusCodes[code] = (requestMetrics.statusCodes[code] || 0) + 1;
        if (code >= 500) requestMetrics.errors++;
    });
    next();
});

app.get('/metrics', (req, res) => {
    const io = req.app.get('io');
    const sockets = io ? io.engine?.clientsCount || 0 : 0;

    return ok(res, {
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        requests: { ...requestMetrics },
        connections: { activeSockets: sockets },
        process: {
            pid: process.pid,
            nodeVersion: process.version,
            memory: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
        },
    });
});

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const controlRoutes = require('./routes/control');
const { errorHandler, customLogger, notFoundHandler } = require('./middleware/errorHandler');
const dashboardRoutes = require('./routes/dashboard');
const spotifyRoutes = require('./routes/spotify');
const whatsappRoutes = require('./routes/whatsapp');
const discordRoutes = require('./routes/discord');
const googleRoutes = require('./routes/google');
const githubRoutes = require('./routes/github');
const creatorRoutes = require('./routes/creator');
const oauthLoginRoutes = require('./routes/oauthLogin');

app.use(customLogger);

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR, {
    fallthrough: true,
    maxAge: 0,
    index: false,
    dotfiles: 'ignore',
    setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
}));

app.use('/api/v1', apiRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/integrations/spotify', spotifyRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/discord', discordRoutes);
app.use('/api/v1/google', googleRoutes);
app.use('/api/v1/github', githubRoutes);
app.use('/api/v1/creator', creatorRoutes);
app.use('/auth/oauth', oauthLoginRoutes);
app.use('/auth', authRoutes);
app.use('/control', controlRoutes);

app.get('/', (_req, res) => ok(res, {
    version: '1.0.0',
    endpoints: {
        health: '/health',
        api: '/api/v1',
        websocket: 'ws://localhost:' + (process.env.PORT || 3000),
    },
}, {
    message: 'Welcome to the PROMETEO backend',
}));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
