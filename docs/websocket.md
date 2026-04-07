# Documentación WebSocket - PROMETEO Backend

## 🔌 Conexión

El servidor WebSocket funciona sobre Socket.io en el mismo puerto que el servidor HTTP.

```javascript
const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");
```

## 🏷️ Identificación de Clientes

Todos los clientes deben identificarse al conectarse:

### Agente

```javascript
socket.emit("identify", {
  type: "agent",
  agentId: "mi-agente-001", // Opcional, se usa socket.id si no se proporciona
});
```

### Frontend

```javascript
socket.emit("identify", {
  type: "frontend",
});
```

## 📨 Eventos del Agente → Servidor

### `agent-data`

Envía datos del agente al servidor:

```javascript
socket.emit("agent-data", {
  temperature: 25.5,
  humidity: 60,
  pressure: 1013.25,
  status: "active",
  battery: 85,
  location: {
    lat: 40.4168,
    lng: -3.7038,
  },
  // ... otros datos personalizados
});
```

## 📬 Eventos del Servidor → Agente

### `command`

Recibe comandos del servidor:

```javascript
socket.on("command", (data) => {
  const { command, data, timestamp } = data;
  // Procesar comando
});
```

### `data-request`

Solicitud específica de datos:

```javascript
socket.on("data-request", (request) => {
  // Enviar datos solicitados
  socket.emit("agent-data", responseData);
});
```

## 📊 Eventos del Servidor → Frontend

### `agent-data`

Datos recibidos de un agente:

```javascript
socket.on("agent-data", (data) => {
  console.log("Datos del agente:", data);
  // data incluye timestamp y agentId automáticamente
});
```

### `agent-connected`

Notificación de agente conectado:

```javascript
socket.on("agent-connected", (agent) => {
  console.log(`Agente ${agent.agentId} conectado`);
});
```

### `agent-disconnected`

Notificación de agente desconectado:

```javascript
socket.on("agent-disconnected", (agent) => {
  console.log(`Agente ${agent.agentId} desconectado`);
});
```

### `agents-status`

Estado actual de todos los agentes (enviado al conectarse):

```javascript
socket.on("agents-status", (agents) => {
  agents.forEach((agent) => {
    console.log(`${agent.agentId}: ${agent.connectedAt}`);
  });
});
```

## 📤 Eventos del Frontend → Servidor

### `request-agent-data`

Solicitar datos específicos a los agentes:

```javascript
socket.emit("request-agent-data", {
  type: "sensor_reading",
  sensors: ["temperature", "humidity"],
  urgency: "high",
});
```

## 🏓 Eventos de Utilidad

### `ping` / `pong`

Para verificar conectividad:

```javascript
// Cliente envía
socket.emit("ping");

// Servidor responde
socket.on("pong", () => {
  console.log("Conexión activa");
});
```

## 🔄 Salas (Rooms)

El servidor organiza automáticamente los clientes en salas:

- `agents`: Todos los agentes conectados
- `frontend`: Todos los clientes frontend conectados

## 📈 Ejemplo de Flujo Completo

1. **Agente se conecta**:

   ```javascript
   socket.emit("identify", { type: "agent", agentId: "sensor-001" });
   ```

2. **Frontend recibe notificación**:

   ```javascript
   socket.on('agent-connected', (agent) => { ... });
   ```

3. **Agente envía datos periódicamente**:

   ```javascript
   setInterval(() => {
     socket.emit("agent-data", sensorData);
   }, 5000);
   ```

4. **Frontend recibe datos en tiempo real**:

   ```javascript
   socket.on("agent-data", (data) => {
     updateUI(data);
   });
   ```

5. **Frontend solicita datos específicos**:

   ```javascript
   socket.emit("request-agent-data", { command: "get_status" });
   ```

6. **Agente responde a la solicitud**:
   ```javascript
   socket.on("data-request", (request) => {
     socket.emit("agent-data", generateResponse(request));
   });
   ```

## ⚠️ Consideraciones

- Los datos se reenvían automáticamente del agente al frontend
- El servidor mantiene el último dato recibido en memoria
- Los agentes desconectados se notifican automáticamente al frontend
- Todos los eventos incluyen timestamps automáticos
- Los errores de conexión se manejan automáticamente con reconexión
