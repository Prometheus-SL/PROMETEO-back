const errorHandler = (err, req, res, next) => {
    console.error('Error capturado:', err);

    if (err.headers && typeof err.headers === 'object') {
        for (const [key, value] of Object.entries(err.headers)) {
            if (value !== undefined && value !== null) {
                res.setHeader(key, String(value));
            }
        }
    }

    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Error de validacion',
            details: err.message,
        });
    }

    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            error: 'JSON invalido',
            details: 'El formato del JSON enviado no es valido',
        });
    }

    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Error interno del servidor',
        ...(err.code && { code: err.code }),
        ...(err.details !== undefined && { details: err.details }),
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};

const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
    });
};

const customLogger = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
    });

    next();
};

module.exports = {
    errorHandler,
    notFoundHandler,
    customLogger,
};
