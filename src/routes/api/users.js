const express = require('express');
const { authenticateToken, authorizeRole } = require('../../middleware/auth');
const User = require('../../models/User');
const { asyncHandler } = require('../../http/asyncHandler');
const { createHttpError } = require('../../http/errors');
const { created, ok } = require('../../http/responses');
const { ALLOWED_USER_ROLES, assertObjectId } = require('./shared');

const router = express.Router();

router.get('/users', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = String(req.query.search || '');
    const { role, isActive } = req.query;

    const query = {};
    if (search) {
        query.$or = [
            { username: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { name: { $regex: search, $options: 'i' } },
            { surname: { $regex: search, $options: 'i' } },
        ];
    }
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
        User.find(query)
            .select('-password -refreshTokens -tokenInvalidBefore')
            .limit(limit)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 }),
        User.countDocuments(query),
    ]);

    return ok(res, {
        users,
        pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total,
        },
    });
}));

router.post('/users', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    const { username, email, password, role = 'user', name, surname, birthday, isActive = true } = req.body || {};

    if (!username || !email || !password) {
        throw createHttpError(400, 'USER_FIELDS_REQUIRED', 'username, email, and password are required');
    }
    if (password.length < 6) {
        throw createHttpError(400, 'PASSWORD_TOO_SHORT', 'Password must be at least 6 characters long');
    }
    if (!ALLOWED_USER_ROLES.includes(role)) {
        throw createHttpError(400, 'INVALID_ROLE', 'Invalid role');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = await User.findOne({ $or: [{ username }, { email: normalizedEmail }] });
    if (exists) {
        throw createHttpError(409, 'USER_ALREADY_EXISTS', 'Username or email already exists');
    }

    const user = new User({ username, email: normalizedEmail, password, role, name, surname, birthday, isActive });
    await user.save();

    return created(res, { user: user.toJSON() }, { message: 'User created successfully' });
}));

router.get('/users/:id', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');
    const user = await User.findById(req.params.id).select('-password -refreshTokens -tokenInvalidBefore');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return ok(res, { user });
}));

router.patch('/users/:id', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');

    const allowed = ['email', 'name', 'surname', 'birthday', 'isActive'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            updates[key] = req.body[key];
        }
    }
    if (updates.email) {
        updates.email = String(updates.email).trim().toLowerCase();
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
        .select('-password -refreshTokens -tokenInvalidBefore');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return ok(res, { user }, { message: 'User updated' });
}));

router.patch('/users/:id/role', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');
    if (!ALLOWED_USER_ROLES.includes(req.body?.role)) {
        throw createHttpError(400, 'INVALID_ROLE', 'Invalid role');
    }

    const user = await User.findByIdAndUpdate(
        req.params.id,
        { role: req.body.role },
        { new: true, runValidators: true }
    ).select('-password -refreshTokens -tokenInvalidBefore');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return ok(res, { user }, { message: 'Role updated' });
}));

router.patch('/users/:id/status', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');
    if (typeof req.body?.isActive !== 'boolean') {
        throw createHttpError(400, 'INVALID_IS_ACTIVE', 'isActive must be a boolean');
    }
    if (req.user._id.toString() === req.params.id && req.body.isActive === false) {
        throw createHttpError(400, 'SELF_DEACTIVATION_NOT_ALLOWED', 'You cannot deactivate your own user');
    }

    const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: req.body.isActive },
        { new: true, runValidators: true }
    ).select('-password -refreshTokens -tokenInvalidBefore');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return ok(res, { user }, { message: 'Status updated' });
}));

router.post('/users/:id/reset-password', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');
    const password = req.body?.password;
    if (!password || password.length < 6) {
        throw createHttpError(400, 'PASSWORD_TOO_SHORT', 'Password is required and must be at least 6 characters long');
    }

    const user = await User.findById(req.params.id).select('+password');
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    user.password = password;
    await user.save();

    return ok(res, null, { message: 'Password updated successfully' });
}));

router.post('/users/:id/logout-all', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');
    const user = await User.findById(req.params.id);
    if (!user) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    user.revokeAllSessions();
    await user.save();

    return ok(res, null, { message: 'All sessions revoked successfully' });
}));

router.delete('/users/:id', authenticateToken, authorizeRole('admin'), asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'INVALID_USER_ID', 'Invalid user id');
    if (req.user._id.toString() === req.params.id) {
        throw createHttpError(400, 'SELF_DELETE_NOT_ALLOWED', 'You cannot delete your own user');
    }

    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) {
        throw createHttpError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return ok(res, null, { message: 'User deleted successfully' });
}));

module.exports = router;
