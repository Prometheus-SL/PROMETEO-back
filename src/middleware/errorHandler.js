// Middleware para manejo de errores
const errorHandler = (err, req, res, next) => {
    console.error('Error capturado:', err);

    // Error de validación
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Error de validación',
            details: err.message
        });
    }

    // Error de sintaxis JSON
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            error: 'JSON inválido',
            details: 'El formato del JSON enviado no es válido'
        });
    }

    // Error genérico del servidor
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Error interno del servidor',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

// Middleware para rutas no encontradas
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
};

// Middleware de logging personalizado
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
    customLogger
};