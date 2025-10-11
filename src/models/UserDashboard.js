const mongoose = require('mongoose');

// Subschemas basados en los tipos del front
const ModuleSizeSchema = new mongoose.Schema({
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 }
}, { _id: false });

const ModuleMetaSchema = new mongoose.Schema({
    id: { type: String, required: true, trim: true },
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

const InstalledModuleSchema = new mongoose.Schema({
    meta: { type: ModuleMetaSchema, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    position: { type: PositionSchema }
}, { _id: false });

const UserDashboardSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    modules: { type: [InstalledModuleSchema], default: [] },
    layout: { type: Object }, // opcional para guardar layout global
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('UserDashboard', UserDashboardSchema);
