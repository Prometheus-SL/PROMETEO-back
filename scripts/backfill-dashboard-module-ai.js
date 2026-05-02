const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const DashboardPage = require('../src/models/DashboardPage');
const DashboardVersion = require('../src/models/DashboardVersion');
const { mergeAiActionsIntoModules } = require('../src/services/ai/backfillModuleAi');

const MODULES_ROOT = path.resolve(__dirname, '../../PROMETEO-front/modules');

function normalizeActions(actions) {
    return Array.from(new Set(
        (Array.isArray(actions) ? actions : [])
            .map((action) => String(action || '').trim())
            .filter(Boolean)
    ));
}

function loadModuleActionsById() {
    const actionsById = new Map();
    if (!fs.existsSync(MODULES_ROOT)) {
        return actionsById;
    }

    for (const entry of fs.readdirSync(MODULES_ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(MODULES_ROOT, entry.name, 'module.json');
        if (!fs.existsSync(manifestPath)) continue;

        try {
            const raw = fs.readFileSync(manifestPath, 'utf8');
            const parsed = JSON.parse(raw);
            const definitions = Array.isArray(parsed) ? parsed : [parsed];

            for (const definition of definitions) {
                const moduleId = String(definition?.id || '').trim();
                const actions = normalizeActions(definition?.ai?.actions);
                if (!moduleId || actions.length === 0) continue;
                actionsById.set(moduleId, actions);
            }
        } catch (error) {
            console.warn(`No pude leer ${manifestPath}: ${error.message}`);
        }
    }

    return actionsById;
}

async function backfillDashboardPages(actionsById) {
    const pages = await DashboardPage.find({});
    let changedPages = 0;
    let changedModules = 0;

    for (const page of pages) {
        const result = mergeAiActionsIntoModules(page.modules, actionsById);
        if (result.changedCount === 0) continue;

        page.modules = result.modules;
        await page.save();
        changedPages += 1;
        changedModules += result.changedCount;
    }

    return { changedPages, changedModules };
}

async function backfillDashboardVersions(actionsById) {
    const versions = await DashboardVersion.find({});
    let changedVersions = 0;
    let changedModules = 0;

    for (const version of versions) {
        const result = mergeAiActionsIntoModules(version?.snapshot?.modules, actionsById);
        if (result.changedCount === 0) continue;

        version.snapshot = {
            ...(version.snapshot || {}),
            modules: result.modules,
        };
        await version.save();
        changedVersions += 1;
        changedModules += result.changedCount;
    }

    return { changedVersions, changedModules };
}

async function run() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI no configurado');
        process.exit(1);
    }

    const actionsById = loadModuleActionsById();
    if (actionsById.size === 0) {
        console.error('No se encontraron acciones AI en los module.json del frontend');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log(`Conectado a MongoDB. Modulos con AI actions: ${actionsById.size}`);

    const pageStats = await backfillDashboardPages(actionsById);
    const versionStats = await backfillDashboardVersions(actionsById);

    console.log(
        `DashboardPage actualizado: ${pageStats.changedPages} paginas, ${pageStats.changedModules} modulos`,
    );
    console.log(
        `DashboardVersion actualizado: ${versionStats.changedVersions} versiones, ${versionStats.changedModules} modulos`,
    );

    await mongoose.disconnect();
}

run().catch(async (error) => {
    console.error('Backfill de ai.actions falló:', error);
    try {
        await mongoose.disconnect();
    } catch (_disconnectError) {
        // Ignore disconnect errors during failure handling.
    }
    process.exit(1);
});
