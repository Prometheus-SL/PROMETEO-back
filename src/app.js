const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
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

app.get('/health', (_req, res) => ok(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
}, {
    message: 'PROMETEO server is healthy',
}));

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

app.use(customLogger);

app.use('/api/v1', apiRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/integrations/spotify', spotifyRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/discord', discordRoutes);
app.use('/api/v1/google', googleRoutes);
app.use('/api/v1/github', githubRoutes);
app.use('/api/v1/creator', creatorRoutes);
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
