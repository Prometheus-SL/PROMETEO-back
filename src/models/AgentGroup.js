const mongoose = require('mongoose');

const agentGroupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
    },
    description: {
        type: String,
        default: '',
        maxlength: 500,
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    agents: [{
        type: String,
        ref: 'Agent',
    }],
    color: {
        type: String,
        default: '#6366f1',
        match: /^#[0-9a-fA-F]{6}$/,
    },
}, {
    timestamps: true,
});

agentGroupSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('AgentGroup', agentGroupSchema);
