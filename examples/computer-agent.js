// Cliente Agente PROMETEO - Simulador de programa instalado en equipo
// Este programa simula un agente que se ejecuta en el ordenador del usuario

const { io } = require('socket.io-client');
const os = require('os');
const { execSync, exec } = require('child_process');

class PrometeoAgent {
    constructor(config) {
        this.config = {
            serverUrl: config.serverUrl || 'http://localhost:3000',
            agentId: config.agentId || `PC-${os.hostname()}`,
            // token JWT del usuario propietario, obtenido desde /auth/agent/login
            token: config.token || process.env.PROMETEO_TOKEN || null,
            monitoringInterval: config.monitoringInterval || 30000, // 30 segundos
            ...config
        };

        this.socket = null;
        this.isConnected = false;
        this.systemInfo = this.getSystemInfo();
        this.monitoringTimer = null;

        console.log(`🖥️  Iniciando Agente PROMETEO para: ${this.systemInfo.hostname}`);
        console.log(`🆔 Agent ID: ${this.config.agentId}`);
    }

    // Obtener información del sistema
    getSystemInfo() {
        return {
            hostname: os.hostname(),
            username: os.userInfo().username,
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            uptime: os.uptime(),
            memory: {
                total: Math.round(os.totalmem() / 1024 / 1024 / 1024), // GB
                free: Math.round(os.freemem() / 1024 / 1024 / 1024)    // GB
            },
            cpu: {
                model: os.cpus()[0].model,
                cores: os.cpus().length,
                speed: os.cpus()[0].speed
            },
            network: os.networkInterfaces()
        };
    }

    // Conectar al servidor
    connect() {
        this.socket = io(this.config.serverUrl, {
            timeout: 20000,
            retries: 3
        });

        this.socket.on('connect', () => {
            console.log(`✅ Conectado al servidor PROMETEO: ${this.socket.id}`);
            this.isConnected = true;

            // Identificarse como agente (enviar token obligatorio)
            this.socket.emit('identify', {
                type: 'agent',
                agentId: this.config.agentId,
                token: this.config.token
            });

            // Enviar información inicial del sistema
            this.sendSystemInfo();

            // Iniciar monitoreo periódico
            this.startMonitoring();
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Desconectado del servidor');
            this.isConnected = false;
            this.stopMonitoring();
        });

        this.socket.on('connect_error', (error) => {
            console.error('🚫 Error de conexión:', error.message);
        });

        // Escuchar comandos del servidor
        this.socket.on('command', (commandData) => {
            console.log('📨 Comando recibido:', commandData);
            this.handleCommand(commandData);
        });

        this.socket.on('data-request', (request) => {
            console.log('📋 Solicitud de datos:', request);
            this.handleDataRequest(request);
        });
    }

    // Enviar información del sistema
    sendSystemInfo() {
        const systemData = {
            type: 'system_info',
            hostname: this.systemInfo.hostname,
            username: this.systemInfo.username,
            os: {
                platform: this.systemInfo.platform,
                release: this.systemInfo.release,
                arch: this.systemInfo.arch
            },
            hardware: {
                cpu: this.systemInfo.cpu,
                memory: this.systemInfo.memory
            },
            uptime: os.uptime(),
            timestamp: new Date().toISOString()
        };

        this.socket.emit('agent-data', systemData);
    }

    // Iniciar monitoreo periódico
    startMonitoring() {
        this.monitoringTimer = setInterval(() => {
            if (this.isConnected) {
                this.sendPerformanceData();
            }
        }, this.config.monitoringInterval);
    }

    // Parar monitoreo
    stopMonitoring() {
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
        }
    }

    // Enviar datos de rendimiento
    sendPerformanceData() {
        const performanceData = {
            type: 'performance',
            cpu: this.getCpuUsage(),
            memory: {
                total: Math.round(os.totalmem() / 1024 / 1024 / 1024),
                free: Math.round(os.freemem() / 1024 / 1024 / 1024),
                used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024),
                percentage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
            },
            uptime: os.uptime(),
            loadAverage: os.loadavg(),
            timestamp: new Date().toISOString()
        };

        this.socket.emit('agent-data', performanceData);
    }

    // Simular uso de CPU (en un agente real usarías librerías como 'pidusage')
    getCpuUsage() {
        return {
            percentage: Math.round(Math.random() * 100),
            cores: os.cpus().length,
            model: os.cpus()[0].model
        };
    }

    // Manejar comandos recibidos
    async handleCommand(commandData) {
        const { commandId, command, parameters = {}, sentBy, timestamp } = commandData;

        // Confirmar recepción
        this.socket.emit('command-received', { commandId });

        console.log(`🔧 Ejecutando comando: ${command}`);
        const startTime = Date.now();

        try {
            let result = null;

            switch (command) {
                case 'volume_set':
                    result = await this.setVolume(parameters.level);
                    break;

                case 'volume_mute':
                    result = await this.muteVolume();
                    break;

                case 'volume_unmute':
                    result = await this.unmuteVolume();
                    break;

                case 'lock_screen':
                    result = await this.lockScreen();
                    break;

                case 'get_system_info':
                    result = this.getSystemInfo();
                    break;

                case 'take_screenshot':
                    result = await this.takeScreenshot();
                    break;

                case 'send_message':
                    result = await this.showMessage(parameters.title, parameters.message, parameters.type);
                    break;

                case 'list_processes':
                    result = await this.listProcesses();
                    break;

                default:
                    throw new Error(`Comando no soportado: ${command}`);
            }

            const executionTime = Date.now() - startTime;

            // Enviar respuesta exitosa
            this.socket.emit('command-response', {
                commandId,
                success: true,
                result,
                executionTime
            });

            console.log(`✅ Comando ${command} ejecutado exitosamente en ${executionTime}ms`);

        } catch (error) {
            const executionTime = Date.now() - startTime;

            // Enviar respuesta de error
            this.socket.emit('command-response', {
                commandId,
                success: false,
                error: error.message,
                executionTime
            });

            console.error(`❌ Error ejecutando comando ${command}:`, error.message);
        }
    }

    // Manejar solicitudes de datos
    handleDataRequest(request) {
        const { type, urgency } = request;

        switch (type) {
            case 'performance':
                this.sendPerformanceData();
                break;

            case 'system_info':
                this.sendSystemInfo();
                break;

            default:
                console.log(`📊 Solicitud de datos no reconocida: ${type}`);
        }
    }

    // Simulaciones de comandos (en un agente real usarías APIs del sistema)

    async setVolume(level) {
        // Simulación - en Windows usarías nircmd o PowerShell
        console.log(`🔊 Simulando: Establecer volumen a ${level}%`);

        if (os.platform() === 'win32') {
            // En Windows real:
            // execSync(`nircmd.exe setsysvolume ${Math.round(level * 655.35)}`);
            return { message: `Volumen establecido a ${level}%`, level };
        }

        return { message: 'Comando de volumen simulado', level };
    }

    async muteVolume() {
        console.log('🔇 Simulando: Silenciar volumen');
        return { message: 'Volumen silenciado', muted: true };
    }

    async unmuteVolume() {
        console.log('🔊 Simulando: Activar volumen');
        return { message: 'Volumen activado', muted: false };
    }

    async lockScreen() {
        console.log('🔒 Simulando: Bloquear pantalla');

        if (os.platform() === 'win32') {
            // En Windows real:
            // execSync('rundll32.exe user32.dll,LockWorkStation');
            return { message: 'Pantalla bloqueada', locked: true };
        }

        return { message: 'Bloqueo de pantalla simulado', locked: true };
    }

    async takeScreenshot() {
        console.log('📸 Simulando: Captura de pantalla');
        return {
            message: 'Captura de pantalla tomada',
            filename: `screenshot_${Date.now()}.png`,
            size: '1920x1080'
        };
    }

    async showMessage(title = 'PROMETEO', message, type = 'info') {
        console.log(`💬 Simulando mensaje: ${title} - ${message}`);

        if (os.platform() === 'win32') {
            // En Windows real podrías usar:
            // execSync(`msg * "${title}: ${message}"`);
        }

        return {
            message: 'Mensaje mostrado al usuario',
            title,
            content: message,
            type
        };
    }

    async listProcesses() {
        console.log('📋 Simulando: Listar procesos');

        // En un agente real obtendrías la lista real de procesos
        const mockProcesses = [
            { name: 'chrome.exe', pid: 1234, memory: '150MB', cpu: '5%' },
            { name: 'notepad.exe', pid: 5678, memory: '15MB', cpu: '0%' },
            { name: 'explorer.exe', pid: 9012, memory: '80MB', cpu: '2%' }
        ];

        return { processes: mockProcesses, count: mockProcesses.length };
    }

    // Desconectar agente
    disconnect() {
        console.log('🔄 Cerrando agente...');
        this.stopMonitoring();
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

// Configuración del agente
const agentConfig = {
    serverUrl: 'http://localhost:3000',
    agentId: `PC-${os.hostname()}-${Date.now()}`,
    monitoringInterval: 15000 // 15 segundos
};

// Crear e iniciar agente
const agent = new PrometeoAgent(agentConfig);
agent.connect();

// Manejo de cierre graceful
process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando agente PROMETEO...');
    agent.disconnect();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Error no capturado:', error);
    agent.disconnect();
    process.exit(1);
});

console.log('🚀 Agente PROMETEO iniciado');
console.log('📊 Enviando datos cada 15 segundos');
console.log('⌨️  Presiona Ctrl+C para salir');