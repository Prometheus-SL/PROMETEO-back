const mongoose = require('mongoose');

const dashboardVersionSchema = new mongoose.Schema({
    pageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DashboardPage',
        required: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    version: {
        type: Number,
        required: true,
    },
    snapshot: {
        name: String,
        slug: String,
        description: String,
        style: mongoose.Schema.Types.Mixed,
        modules: mongoose.Schema.Types.Mixed,
    },
    changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});

dashboardVersionSchema.index({ pageId: 1, version: -1 });
dashboardVersionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('DashboardVersion', dashboardVersionSchema);
