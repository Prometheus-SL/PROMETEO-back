const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username es requerido'],
        unique: true,
        trim: true,
        minlength: [3, 'Username debe tener al menos 3 caracteres'],
        maxlength: [30, 'Username no puede exceder 30 caracteres']
    },
    email: {
        type: String,
        required: [true, 'Email es requerido'],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail, 'Email inválido']
    },
    password: {
        type: String,
        required: [true, 'Password es requerido'],
        minlength: [6, 'Password debe tener al menos 6 caracteres'],
        select: false // No incluir password en consultas por defecto
    },
    role: {
        type: String,
        enum: ['admin', 'user'],
        default: 'user'
    },
    name: {
        type: String,
        trim: true,
        maxlength: [50, 'Name no puede exceder 50 caracteres']
    },
    surname: {
        type: String,
        trim: true,
        maxlength: [50, 'Surname no puede exceder 50 caracteres']
    },
    birthday: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    refreshTokens: [{
        token: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

// Middleware para hash de password antes de guardar
userSchema.pre('save', async function (next) {
    // Solo hash si password fue modificado
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Método para comparar passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Método para limpiar tokens expirados (7 días)
userSchema.methods.cleanExpiredTokens = function () {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.refreshTokens = this.refreshTokens.filter(
        rt => rt.createdAt > sevenDaysAgo
    );
    return this;
};

// Método para obtener usuario sin datos sensibles
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.refreshTokens;
    return user;
};

module.exports = mongoose.model('User', userSchema);