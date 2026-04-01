const mongoose = require('mongoose');

// Subschemas reutilizables
const ModuleSizeSchema = new mongoose.Schema({
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 }
}, { _id: false });

const ModuleMetaSchema = new mongoose.Schema({
    id: { type: String, required: true, trim: true }, // identificador del módulo (del catálogo del front)
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true },
    size: { type: ModuleSizeSchema },
    entry: { type: String, required: true, trim: true },
    configSchema: { type: String, trim: true },
    preview: { type: String, trim: true }
}, { _id: false });

const PositionSchema = new mongoose.Schema({
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    w: { type: Number, default: 1 },
    h: { type: Number, default: 1 }
}, { _id: false });

// Cada instancia de módulo DEBE tener _id para poder actualizar/eliminar por instancia
const InstalledModuleSchema = new mongoose.Schema({
    meta: { type: ModuleMetaSchema, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    position: { type: PositionSchema }
}, { _id: true });

const DashboardPageSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true }, // único por usuario
    description: { type: String, trim: true },
    style: { type: mongoose.Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    modules: { type: [InstalledModuleSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Índices
DashboardPageSchema.index({ user: 1, slug: 1 }, { unique: true });
DashboardPageSchema.index({ user: 1, order: 1 });

// Utilidad para slug
function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
}

// Asegurar slug antes de validar
DashboardPageSchema.pre('validate', function () {
    if (!this.slug && this.name) {
        this.slug = slugify(this.name);
    }
});

module.exports = mongoose.model('DashboardPage', DashboardPageSchema);
