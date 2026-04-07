# Control Remoto de Equipos - PROMETEO

## 🖥️ Descripción General

PROMETEO es un sistema de monitoreo y control remoto diseñado para administrar equipos de usuarios de forma centralizada. Los agentes se instalan como programas en los ordenadores de los usuarios y permiten:

- **Monitoreo en tiempo real** del rendimiento del sistema
- **Control remoto** de funciones del equipo
- **Ejecución de comandos** administrativos
- **Recopilación de información** del sistema

## 🎯 Casos de Uso

### Para IT/Administradores

- **Soporte técnico remoto** sin necesidad de acceso físico
- **Monitoreo de salud** de equipos en tiempo real
- **Aplicación de políticas** de seguridad centralizadas
- **Gestión de energía** (apagado/reinicio programado)
- **Control de volumen** para presentaciones/reuniones

### Para Seguridad

- **Bloqueo remoto** de equipos comprometidos
- **Monitoreo de procesos** sospechosos
- **Aplicación de medidas** de seguridad inmediatas
- **Recopilación de evidencia** (capturas de pantalla)

### Para Gestión de Flotas

- **Inventario automático** de hardware y software
- **Actualizaciones coordinadas** de sistemas
- **Monitoreo de uso** y rendimiento
- **Notificaciones a usuarios** sobre mantenimiento

## 🔧 Comandos Disponibles

### Control de Audio

```json
{
  "command": "volume_set",
  "parameters": { "level": 50 }
}
```

- `volume_set` - Establecer volumen (0-100)
- `volume_mute` - Silenciar audio
- `volume_unmute` - Activar audio
- `volume_up` - Subir volumen
- `volume_down` - Bajar volumen

### Control de Sesión

```json
{
  "command": "lock_screen"
}
```

- `lock_screen` - Bloquear pantalla
- `unlock_screen` - Desbloquear pantalla
- `logout_user` - Cerrar sesión del usuario
- `switch_user` - Cambiar usuario

### Control de Energía

```json
{
  "command": "shutdown",
  "parameters": { "delay": 300 }
}
```

- `shutdown` - Apagar equipo
- `restart` - Reiniciar equipo
- `hibernate` - Hibernar equipo
- `sleep` - Suspender equipo

### Monitoreo del Sistema

```json
{
  "command": "get_system_info"
}
```

- `get_system_info` - Información completa del sistema
- `get_performance` - Métricas de rendimiento actual
- `take_screenshot` - Captura de pantalla
- `get_network_info` - Estado de conexiones de red

### Gestión de Procesos

```json
{
  "command": "list_processes"
}
```

- `list_processes` - Listar procesos en ejecución
- `kill_process` - Terminar proceso específico
- `start_process` - Iniciar aplicación

### Comunicación con Usuario

```json
{
  "command": "send_message",
  "parameters": {
    "title": "IT Support",
    "message": "Su equipo será reiniciado en 5 minutos",
    "type": "warning"
  }
}
```

## 📡 API Endpoints

### Enviar Comando Individual

```http
POST /control/command
Authorization: Bearer <token>
Content-Type: application/json

{
  "agentId": "PC-WORKSTATION-001",
  "command": "volume_set",
  "parameters": { "level": 30 },
  "priority": "normal"
}
```

### Comandos en Lote

```http
POST /control/commands/batch
Authorization: Bearer <token>

{
  "agentIds": ["PC-001", "PC-002", "PC-003"],
  "command": "lock_screen",
  "priority": "high"
}
```

### Control de Volumen Simplificado

```http
POST /control/volume
Authorization: Bearer <token>

{
  "agentId": "PC-001",
  "action": "set",
  "level": 50
}
```

### Bloqueo de Pantalla

```http
POST /control/lock
Authorization: Bearer <token>

{
  "agentId": "PC-001",
  "action": "lock"
}
```

### Control de Energía

```http
POST /control/power
Authorization: Bearer <token>

{
  "agentId": "PC-001",
  "action": "shutdown",
  "delay": 300
}
```

### Enviar Mensaje al Usuario

```http
POST /control/message
Authorization: Bearer <token>

{
  "agentId": "PC-001",
  "title": "Mantenimiento Programado",
  "message": "El sistema se reiniciará a las 18:00",
  "type": "info"
}
```

## 💻 Instalación del Agente

### 1. Descargar Agente

```bash
# En cada equipo de usuario
git clone https://github.com/tu-org/prometeo-agent
cd prometeo-agent
npm install
```

### 2. Configurar Agente

```javascript
// config.js
module.exports = {
  serverUrl: "https://prometeo.tu-empresa.com",
  agentId: "PC-" + require("os").hostname(),
  apiKey: process.env.PROMETEO_API_KEY,
  monitoringInterval: 30000,
  capabilities: [
    "system_monitor",
    "volume_control",
    "screen_lock",
    "power_management",
  ],
};
```

### 3. Ejecutar como Servicio

**Windows (como Servicio):**

```bash
npm install -g node-windows
node install-service.js
```

**Linux (systemd):**

```bash
sudo cp prometeo-agent.service /etc/systemd/system/
sudo systemctl enable prometeo-agent
sudo systemctl start prometeo-agent
```

## 📊 Datos del Sistema

### Información Enviada Automáticamente

```json
{
  "type": "system_status",
  "hostname": "PC-WORKSTATION-001",
  "username": "juan.perez",
  "os": {
    "platform": "win32",
    "release": "10.0.19044",
    "arch": "x64"
  },
  "cpu": {
    "model": "Intel Core i7-10700K",
    "cores": 8,
    "usage": 25
  },
  "memory": {
    "total": 16,
    "used": 8,
    "percentage": 50
  },
  "uptime": 86400,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Métricas de Rendimiento

```json
{
  "type": "performance",
  "cpu_usage": 15.5,
  "memory_usage": 62.3,
  "disk_usage": {
    "C:": { "total": 500, "free": 150, "used": 350 }
  },
  "network": {
    "bytes_sent": 1024000,
    "bytes_received": 2048000
  }
}
```

## 🔒 Seguridad

### Autenticación del Agente

- Cada agente tiene una **API Key única**
- Conexión **TLS/SSL** obligatoria en producción
- **Certificados** para validar identidad del servidor

### Autorización de Comandos

- **Roles de usuario**: admin, operator, viewer
- **Comandos críticos** requieren rol admin
- **Logging completo** de todos los comandos

### Privacidad

- **No se almacenan** datos personales del usuario
- **Captura de pantalla** solo con autorización explícita
- **Datos encriptados** en tránsito y almacenamiento

## 🚨 Casos de Emergencia

### Bloqueo Masivo

```bash
curl -X POST https://prometeo.empresa.com/control/commands/batch \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "agentIds": "*",
    "command": "lock_screen",
    "priority": "urgent"
  }'
```

### Apagado de Emergencia

```bash
curl -X POST https://prometeo.empresa.com/control/power \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "agentId": "PC-COMPROMISED-001",
    "action": "shutdown",
    "delay": 0
  }'
```

### Mensaje de Emergencia

```bash
curl -X POST https://prometeo.empresa.com/control/message \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "agentId": "*",
    "title": "ALERTA DE SEGURIDAD",
    "message": "Desconecte inmediatamente de la red",
    "type": "critical"
  }'
```

## 🛠️ Desarrollo del Agente

### Estructura Básica

```javascript
class PrometeoAgent {
  constructor(config) {
    this.config = config;
    this.socket = null;
  }

  connect() {
    // Conectar al servidor
  }

  handleCommand(command) {
    // Procesar comandos recibidos
  }

  sendSystemData() {
    // Enviar datos del sistema
  }
}
```

### Implementar Comando Personalizado

```javascript
async executeCustomCommand(parameters) {
  try {
    // Tu lógica personalizada aquí
    const result = await myCustomLogic(parameters);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

## 📈 Monitoreo y Alertas

### Dashboard en Tiempo Real

- **Estado de conectividad** de todos los agentes
- **Métricas de rendimiento** agregadas
- **Historial de comandos** ejecutados
- **Alertas automáticas** por uso excesivo de recursos

### Notificaciones

- **Email/SMS** para eventos críticos
- **Webhooks** para integración con otros sistemas
- **Logs centralizados** para auditoría

El sistema PROMETEO proporciona control completo y monitoreo avanzado de tu flota de equipos, asegurando productividad y seguridad en toda la organización. 🎯
