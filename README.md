# PROMETEO Backend

Servidor backend para el proyecto PROMETEO con soporte para WebSocket y API REST.

## 🚀 Características

- **Express.js** - Framework web rápido y minimalista
- **Socket.io** - Comunicación WebSocket en tiempo real
- **CORS** - Soporte para Cross-Origin Resource Sharing
- **Helmet** - Middleware de seguridad
- **Morgan** - Logging de peticiones HTTP
- **Compresión** - Compresión gzip automática

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

### Endpoints Disponibles

- `GET /` - Información general del servidor
- `GET /health` - Estado de salud del servidor
- `GET /api/v1/agents` - Información de agentes conectados
- `GET /api/v1/stats` - Estadísticas del servidor
- `POST /api/v1/agents/command` - Enviar comando a agentes
- `GET /api/v1/data/latest` - Obtener último dato recibido

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
