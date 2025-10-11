# PROMETEO Backend

Servidor backend para el proyecto PROMETEO con soporte para WebSocket y API REST.

## 🚀 Características

### Backend

- **Express.js** - Framework web rápido y minimalista
- **Socket.io** - Comunicación WebSocket en tiempo real
- **MongoDB** - Base de datos NoSQL con Mongoose
- **JWT** - Autenticación segura con tokens
- **CORS** - Soporte para Cross-Origin Resource Sharing
- **Helmet** - Middleware de seguridad
- **Morgan** - Logging de peticiones HTTP

### Control Remoto

- **Monitoreo en tiempo real** de equipos de usuarios
- **Control remoto** de funciones del sistema (volumen, bloqueo, energía)
- **Ejecución de comandos** administrativos
- **Gestión centralizada** de flotas de equipos
- **Autenticación por roles** (admin/operator/viewer)
- **API Keys** para agentes seguros

## 📁 Estructura del Proyecto

```
PROMETEO-back/
├── src/
│   ├── middleware/
│   │   └── errorHandler.js    # Middleware de manejo de errores
│   ├── routes/
│   │   └── api.js            # Rutas de la API REST
│   ├── app.js                # Configuración de Express
│   └── server.js             # Servidor principal con Socket.io
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## 🛠️ Instalación

1. Clona el repositorio:

```bash
git clone <repository-url>
cd PROMETEO-back
```

2. Instala las dependencias:

```bash
npm install
```

3. Copia el archivo de configuración de ejemplo:

```bash
copy .env.example .env
```

4. Configura las variables de entorno en `.env` según tus necesidades.

## 🏃 Uso

### Desarrollo

```bash
npm run dev
```

### Producción

```bash
npm start
```

El servidor se ejecutará en `http://localhost:3000` por defecto.

## 📡 WebSocket

### Eventos del Agente

El agente debe conectarse e identificarse como tal:

```javascript
const socket = io("http://localhost:3000");

// Identificarse como agente
socket.emit("identify", {
  type: "agent",
  agentId: "mi-agente-001",
});

// Enviar datos
socket.emit("agent-data", {
  temperature: 25.5,
  humidity: 60,
  status: "active",
});
```

### Eventos del Frontend

El frontend debe conectarse e identificarse:

```javascript
const socket = io("http://localhost:3000");

// Identificarse como frontend
socket.emit("identify", {
  type: "frontend",
});

// Escuchar datos del agente
socket.on("agent-data", (data) => {
  console.log("Datos del agente:", data);
});

// Escuchar estado de agentes
socket.on("agent-connected", (agent) => {
  console.log("Agente conectado:", agent);
});

socket.on("agent-disconnected", (agent) => {
  console.log("Agente desconectado:", agent);
});
```

#### ⚠️ Consideraciones

- Los datos se reenvían automáticamente del agente al frontend
- El servidor mantiene el último dato recibido en memoria
- Los agentes desconectados se notifican automáticamente al frontend
- Todos los eventos incluyen timestamps automáticos
- Los errores de conexión se manejan automáticamente con reconexión

## 🌐 API REST

### Endpoints de Sistema

- `GET /` - Información general del servidor
- `GET /health` - Estado de salud del servidor
- `GET /api/v1/stats` - Estadísticas del servidor

### Autenticación

- `POST /auth/login` - Iniciar sesión
- `POST /auth/register` - Registrar usuario
- `GET /auth/me` - Info del usuario actual
- `POST /auth/refresh` - Renovar tokens

### Gestión de Agentes

- `GET /api/v1/agents` - Listar agentes conectados
- `POST /api/v1/agents` - Registrar nuevo agente
- `GET /api/v1/agents/:id/data` - Datos de un agente
- `PATCH /api/v1/agents/:id` - Actualizar agente

### Control Remoto

- `POST /control/command` - Ejecutar comando en agente
- `POST /control/commands/batch` - Comandos en lote
- `POST /control/volume` - Control de volumen
- `POST /control/lock` - Bloquear/desbloquear pantalla
- `POST /control/power` - Control de energía
- `POST /control/message` - Enviar mensaje al usuario

### Dashboards/Páginas por Usuario

- `GET /api/v1/dashboard/pages` - Listar mis páginas
- `GET /api/v1/dashboard/pages/active` - Obtener mi página activa
- `GET /api/v1/dashboard/pages/by-slug/:slug` - Obtener página por slug
- `GET /api/v1/dashboard/pages/:id` - Detalle página
- `POST /api/v1/dashboard/pages` - Crear página
- `PATCH /api/v1/dashboard/pages/:id` - Actualizar página (activar, estilo, etc.)
- `DELETE /api/v1/dashboard/pages/:id` - Eliminar página
- `PATCH /api/v1/dashboard/pages/reorder` - Reordenar páginas
- `POST /api/v1/dashboard/pages/:id/modules` - Añadir módulo
- `PATCH /api/v1/dashboard/pages/:id/modules/:moduleId` - Actualizar módulo
- `DELETE /api/v1/dashboard/pages/:id/modules/:moduleId` - Eliminar módulo
- `PATCH /api/v1/dashboard/pages/:id/modules/reorder` - Actualizar layout en bloque

### Ejemplos de Uso

```bash
# Verificar estado del servidor
curl http://localhost:3000/health

# Obtener estadísticas
curl http://localhost:3000/api/v1/stats

# Enviar comando a agentes
curl -X POST http://localhost:3000/api/v1/agents/command \
  -H "Content-Type: application/json" \
  -d '{"command": "get_status", "data": {}}'
```

## ⚙️ Configuración

Las variables de entorno disponibles:

- `PORT` - Puerto del servidor (default: 3000)
- `CLIENT_URL` - URL del cliente para CORS (default: http://localhost:3001)
- `NODE_ENV` - Entorno de ejecución (development/production)

## 🔧 Desarrollo

Para añadir nuevas rutas, crea archivos en `src/routes/` y regístralas en `src/app.js`.

Para añadir middleware personalizado, créalo en `src/middleware/`.

## 📝 Logs

El servidor utiliza Morgan para logging automático de peticiones HTTP y console.log para eventos de WebSocket.

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request
