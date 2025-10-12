const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken, authorizeRole, requireAgentOwnership } = require('../middleware/auth');
const Agent = require('../models/Agent');
const AgentData = require('../models/AgentData');
const User = require('../models/User');
const router = express.Router();

// Ruta para obtener información de agentes conectados (solo admin/operator)
router.get('/agents', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const io = req.app.get('io');
        const { page = 1, limit = 10, status, search } = req.query;

        // Construir query de búsqueda
        let query = {};
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { agentId: { $regex: search, $options: 'i' } },
                { name: { $regex: search, $options: 'i' } }
            ];
        }

        // Obtener agentes de la base de datos
        const agents = await Agent.find(query)
            .select('-apiKey') // No incluir API keys por seguridad
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ lastSeen: -1 });

        const total = await Agent.countDocuments(query);

        // Obtener información de sockets conectados
        const connectedSockets = [];
        io.of('/').sockets.forEach((socket) => {
            connectedSockets.push({
                id: socket.id,
                connected: socket.connected,
                rooms: Array.from(socket.rooms),
                agentId: socket.agentId || null
            });
        });

        res.json({
            success: true,
            data: {
                agents,
                pagination: {
                    current: page * 1,
                    pages: Math.ceil(total / limit),
                    total
                },
                connections: {
                    total: connectedSockets.length,
                    sockets: connectedSockets
                }
            }
        });
    } catch (error) {
        console.error('Error obteniendo agentes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Ruta para obtener estadísticas del servidor (solo admin/operator)
router.get('/stats', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const io = req.app.get('io');

        // Estadísticas de la base de datos
        const [totalAgents, activeAgents, totalUsers, totalData] = await Promise.all([
            Agent.countDocuments(),
            Agent.countDocuments({ isOnline: true }),
            User.countDocuments({ isActive: true }),
            AgentData.countDocuments()
        ]);

        res.json({
            success: true,
            data: {
                server: {
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    timestamp: new Date().toISOString(),
                    version: '1.0.0'
                },
                connections: {
                    total: io.of('/').sockets.size,
                    agents: io.sockets.adapter.rooms.get('agents')?.size || 0,
                    frontend: io.sockets.adapter.rooms.get('frontend')?.size || 0
                },
                database: {
                    totalAgents,
                    activeAgents,
                    totalUsers,
                    totalData
                }
            }
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Ruta para enviar comando a agentes (POST) - solo admin/operator
router.post('/agents/command', authenticateToken, authorizeRole('admin', 'operator'), (req, res) => {
    const io = req.app.get('io');
    const { command, data, agentId } = req.body;

    if (!command) {
        return res.status(400).json({
            success: false,
            error: 'Comando requerido'
        });
    }

    const commandData = {
        command,
        data,
        timestamp: new Date().toISOString(),
        sentBy: req.user.username
    };

    if (agentId) {
        // Enviar comando a agente específico
        const targetSocket = Array.from(io.of('/').sockets.values())
            .find(socket => socket.agentId === agentId);

        if (targetSocket) {
            targetSocket.emit('command', commandData);
            res.json({
                success: true,
                message: `Comando '${command}' enviado al agente ${agentId}`,
                timestamp: commandData.timestamp
            });
        } else {
            res.status(404).json({
                success: false,
                error: `Agente ${agentId} no encontrado o desconectado`
            });
        }
    } else {
        // Enviar comando a todos los agentes conectados
        io.to('agents').emit('command', commandData);
        res.json({
            success: true,
            message: `Comando '${command}' enviado a todos los agentes`,
            timestamp: commandData.timestamp
        });
    }
});

// Ruta para obtener el último dato recibido
router.get('/data/latest', authenticateToken, async (req, res) => {
    try {
        const { agentId, limit = 10 } = req.query;

        let query = {};
        if (agentId) query.agentId = agentId;

        const latestData = await AgentData.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .populate('agentId', 'name agentId location');

        res.json({
            success: true,
            data: {
                latest: latestData,
                count: latestData.length,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error obteniendo datos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Ruta para registrar un nuevo agente (solo admin)
router.post('/agents', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { agentId, name, description, location } = req.body;

        if (!agentId || !name) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID y nombre son requeridos'
            });
        }

        // Verificar que el agentId no exista
        const existingAgent = await Agent.findOne({ agentId });
        if (existingAgent) {
            return res.status(409).json({
                success: false,
                error: 'Agent ID ya existe'
            });
        }

        // Generar API Key única
        const crypto = require('crypto');
        const apiKey = crypto.randomBytes(32).toString('hex');

        const newAgent = new Agent({
            agentId,
            name,
            description,
            apiKey,
            location,
            status: 'inactive'
        });

        await newAgent.save();

        res.status(201).json({
            success: true,
            message: 'Agente registrado exitosamente',
            data: {
                agent: {
                    id: newAgent._id,
                    agentId: newAgent.agentId,
                    name: newAgent.name,
                    description: newAgent.description,
                    apiKey: newAgent.apiKey, // Solo mostrar al crear
                    status: newAgent.status,
                    location: newAgent.location
                }
            }
        });

    } catch (error) {
        console.error('Error registrando agente:', error);

        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                error: 'Error de validación',
                details: errors
            });
        }

        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Ruta para obtener datos de un agente específico
router.get('/agents/:agentId/data', authenticateToken, async (req, res) => {
    try {
        const { agentId } = req.params;
        const {
            page = 1,
            limit = 50,
            startDate,
            endDate,
            dataType
        } = req.query;

        // Construir query
        let query = { agentId };

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        if (dataType) query.dataType = dataType;

        const data = await AgentData.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await AgentData.countDocuments(query);

        res.json({
            success: true,
            data: {
                agentId,
                records: data,
                pagination: {
                    current: page * 1,
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });

    } catch (error) {
        console.error('Error obteniendo datos del agente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Ruta para que los agentes envíen datos (autenticación por JWT del usuario propietario)
router.post('/agents/data', authenticateToken, requireAgentOwnership, async (req, res) => {
    try {
        const agent = req.agent; // establecido por requireAgentOwnership
        const { data, dataType = 'sensor', priority = 'normal', tags = [] } = req.body;

        if (!data) {
            return res.status(400).json({
                success: false,
                error: 'Data es requerida'
            });
        }

        const agentData = new AgentData({
            agentId: agent.agentId,
            data,
            dataType,
            priority,
            tags,
            metadata: {
                socketId: req.headers['x-socket-id'],
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            }
        });

        await agentData.save();

        // Actualizar última actividad del agente
        agent.lastData = new Date();
        await agent.save();

        // Enviar datos al frontend via WebSocket
        const io = req.app.get('io');
        io.to('frontend').emit('agent-data', {
            agentId: agent.agentId,
            data,
            dataType,
            priority,
            tags,
            timestamp: agentData.createdAt
        });

        res.status(201).json({
            success: true,
            message: 'Datos guardados exitosamente',
            data: {
                id: agentData._id,
                timestamp: agentData.createdAt
            }
        });

    } catch (error) {
        console.error('Error guardando datos del agente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Ruta para actualizar estado de un agente (solo admin/operator)
router.patch('/agents/:agentId', authenticateToken, authorizeRole('admin', 'operator'), async (req, res) => {
    try {
        const { agentId } = req.params;
        const updates = req.body;

        // Campos permitidos para actualizar
        const allowedUpdates = ['name', 'description', 'status', 'location', 'metadata'];
        const actualUpdates = {};

        for (const field of allowedUpdates) {
            if (updates[field] !== undefined) {
                actualUpdates[field] = updates[field];
            }
        }

        const agent = await Agent.findOneAndUpdate(
            { agentId },
            actualUpdates,
            { new: true, runValidators: true }
        ).select('-apiKey');

        if (!agent) {
            return res.status(404).json({
                success: false,
                error: 'Agente no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Agente actualizado exitosamente',
            data: { agent }
        });

    } catch (error) {
        console.error('Error actualizando agente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// =============================
// Gestión de Usuarios (Admin)
// =============================

// Listar usuarios con paginación y búsqueda (solo admin)
router.get('/users', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', role, isActive } = req.query;

        const query = {};
        if (search) {
            query.$or = [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { name: { $regex: search, $options: 'i' } },
                { surname: { $regex: search, $options: 'i' } }
            ];
        }
        if (role) query.role = role;
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const users = await User.find(query)
            .select('-password -refreshTokens')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    current: page * 1,
                    pages: Math.ceil(total / limit),
                    total
                }
            }
        });
    } catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Crear usuario (solo admin)
router.post('/users', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { username, email, password, role = 'user', name, surname, birthday, isActive = true } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ success: false, error: 'Username, email y password son requeridos' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const exists = await User.findOne({ $or: [{ username }, { email }] });
        if (exists) {
            return res.status(409).json({ success: false, error: 'Usuario o email ya existe' });
        }

        const newUser = new User({ username, email, password, role, name, surname, birthday, isActive });
        await newUser.save();

        res.status(201).json({
            success: true,
            message: 'Usuario creado exitosamente',
            data: { user: newUser.toJSON() }
        });
    } catch (error) {
        console.error('Error creando usuario:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Obtener detalle de usuario por ID (solo admin)
router.get('/users/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        const user = await User.findById(id).select('-password -refreshTokens');
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, data: { user } });
    } catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Actualizar datos de usuario (solo admin, sin password/rol)
router.patch('/users/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        const allowed = ['email', 'name', 'surname', 'birthday', 'isActive'];
        const updates = {};
        for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];

        const user = await User.findByIdAndUpdate(id, updates, { new: true, runValidators: true })
            .select('-password -refreshTokens');
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });

        res.json({ success: true, message: 'Usuario actualizado', data: { user } });
    } catch (error) {
        console.error('Error actualizando usuario:', error);
        if (error.name === 'ValidationError') {
            const details = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, error: 'Error de validación', details });
        }
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Cambiar rol de usuario (solo admin)
router.patch('/users/:id/role', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        if (!['admin', 'user'].includes(role)) {
            return res.status(400).json({ success: false, error: 'Rol inválido' });
        }
        // Prevenir que un admin se quite a sí mismo si es el único admin (opcional: requiere conteo)
        const user = await User.findByIdAndUpdate(id, { role }, { new: true, runValidators: true })
            .select('-password -refreshTokens');
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, message: 'Rol actualizado', data: { user } });
    } catch (error) {
        console.error('Error actualizando rol:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Activar/Desactivar usuario (solo admin)
router.patch('/users/:id/status', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ success: false, error: 'isActive debe ser booleano' });
        }
        // Evitar que un admin se desactive a sí mismo
        if (req.user._id.toString() === id && isActive === false) {
            return res.status(400).json({ success: false, error: 'No puedes desactivar tu propio usuario' });
        }
        const user = await User.findByIdAndUpdate(id, { isActive }, { new: true, runValidators: true })
            .select('-password -refreshTokens');
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, message: 'Estado actualizado', data: { user } });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Resetear contraseña (solo admin)
router.post('/users/:id/reset-password', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password requerido y debe tener al menos 6 caracteres' });
        }
        const user = await User.findById(id).select('+password');
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        user.password = password; // será hasheado por el pre-save
        await user.save();
        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error reseteando contraseña:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Revocar todos los refresh tokens (logout de todos los dispositivos) (solo admin)
router.post('/users/:id/logout-all', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        user.refreshTokens = [];
        await user.save();
        res.json({ success: true, message: 'Tokens revocados correctamente' });
    } catch (error) {
        console.error('Error revocando tokens:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Eliminar usuario (solo admin)
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de usuario inválido' });
        }
        // Evitar que un admin se borre a sí mismo
        if (req.user._id.toString() === id) {
            return res.status(400).json({ success: false, error: 'No puedes eliminar tu propio usuario' });
        }
        const deleted = await User.findByIdAndDelete(id);
        if (!deleted) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;