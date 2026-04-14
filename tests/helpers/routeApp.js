const path = require('path');
const express = require('express');
const mock = require('mock-require');

const projectRoot = path.resolve(__dirname, '..', '..');

function resolveProjectPath(relativePath) {
    return path.join(projectRoot, relativePath);
}

function clearProjectModule(relativePath) {
    const absolutePath = resolveProjectPath(relativePath);

    try {
        delete require.cache[require.resolve(absolutePath)];
    } catch (_error) {
        // Ignore cache misses for modules that have not been loaded yet.
    }

    return absolutePath;
}

function createRouteApp({ routePath, mountPath, mocks = {} }) {
    for (const [relativePath, mockedExport] of Object.entries(mocks)) {
        mock(resolveProjectPath(relativePath), mockedExport);
        clearProjectModule(relativePath);
    }

    clearProjectModule(routePath);
    clearProjectModule('src/middleware/errorHandler.js');

    const router = require(resolveProjectPath(routePath));
    const {
        errorHandler,
        notFoundHandler,
    } = require(resolveProjectPath('src/middleware/errorHandler.js'));

    const app = express();
    app.use(express.json());
    app.use(mountPath, router);
    app.use(notFoundHandler);
    app.use(errorHandler);

    return {
        app,
        cleanup() {
            mock.stopAll();
            clearProjectModule(routePath);
            clearProjectModule('src/middleware/errorHandler.js');
            for (const relativePath of Object.keys(mocks)) {
                clearProjectModule(relativePath);
            }
        },
    };
}

module.exports = {
    createRouteApp,
};
