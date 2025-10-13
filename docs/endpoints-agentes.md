# Endpoints para Administración de Agentes

## Base URL: `/api/v1`

Todos los endpoints requieren autenticación JWT (`Authorization: Bearer <token>`).

### 📊 **Endpoints de Agentes**

#### 1. **Listar Agentes**
- **GET** `/agents`
- **Permisos:** Admin, Operator
- **Descripción:** Lista todos los agentes con paginación y búsqueda
- **Query Parameters:**
  - `page` (number): Número de página (default: 1)
  - `limit` (number): Elementos por página (default: 10)
  - `status` (string): Filtrar por estado (`online`, `offline`, `maintenance`, `error`, `locked`)
  - `search` (string): Buscar por agentId o nombre
- **Respuesta:** Lista de agentes con información del propietario, paginación e info de conexiones WebSocket

#### 2. **Obtener Agente Específico**
- **GET** `/agents/:agentId`
- **Permisos:** Admin, Operator
- **Descripción:** Obtiene información detallada de un agente específico
- **Respuesta:** Datos del agente + información del propietario + últimos 5 datos enviados

#### 3. **Crear/Registrar Agente**
- **POST** `/agents`
- **Permisos:** Admin
- **Body:**
  ```json
  {
    "agentId": "PC-HOSTNAME",
    "name": "Mi Agente",
    "description": "Descripción opcional",
    "location": "Oficina Principal"
  }
  ```
- **Respuesta:** Agente creado con API Key (solo se muestra una vez)

#### 4. **Actualizar Agente**
- **PATCH** `/agents/:agentId`
- **Permisos:** Admin, Operator
- **Body:** Campos permitidos: `name`, `description`, `status`, `location`, `metadata`
- **Respuesta:** Agente actualizado con información del propietario

#### 5. **Eliminar Agente**
- **DELETE** `/agents/:agentId`
- **Permisos:** Admin
- **Descripción:** Elimina permanentemente un agente

#### 6. **Estadísticas de Agente**
- **GET** `/agents/:agentId/stats`
- **Permisos:** Admin, Operator
- **Query Parameters:**
  - `days` (number): Período en días para las estadísticas (default: 7)
- **Respuesta:** Estadísticas detalladas (total datos, datos por tipo, actividad diaria)

### 📈 **Endpoints de Datos**

#### 7. **Obtener Datos de Agente**
- **GET** `/agents/:agentId/data`
- **Permisos:** Cualquier usuario autenticado
- **Query Parameters:**
  - `page`, `limit`: Paginación
  - `startDate`, `endDate`: Filtro por fechas (ISO format)
  - `dataType`: Filtrar por tipo de dato
- **Respuesta:** Lista de datos con paginación

#### 8. **Últimos Datos Recibidos**
- **GET** `/data/latest`
- **Permisos:** Cualquier usuario autenticado
- **Query Parameters:**
  - `agentId` (string): Filtrar por agente específico
  - `limit` (number): Cantidad de registros (default: 10)
- **Respuesta:** Últimos datos de todos los agentes o de uno específico, con información del agente

#### 9. **Enviar Datos (Para Agentes)**
- **POST** `/agents/data`
- **Permisos:** Usuario propietario del agente (requiere `requireAgentOwnership`)
- **Headers:** `x-agent-id: <AGENT_ID>`
- **Body:**
  ```json
  {
    "data": { "cpu": 45, "memory": 60 },
    "dataType": "sensor",
    "priority": "normal",
    "tags": ["performance"]
  }
  ```

### 🎮 **Endpoints de Control**

#### 10. **Enviar Comando a Agentes**
- **POST** `/agents/command`
- **Permisos:** Admin, Operator
- **Body:**
  ```json
  {
    "command": "volume_set",
    "data": { "level": 50 },
    "agentId": "PC-HOSTNAME" // opcional, sin este envía a todos
  }
  ```

### 📊 **Endpoints de Estadísticas Generales**

#### 11. **Estadísticas del Servidor**
- **GET** `/stats`
- **Permisos:** Admin, Operator
- **Respuesta:** Estadísticas completas del servidor, conexiones WebSocket, BD

---

## 🔐 **Autenticación de Agentes**

### Login de Agente (Para obtener token)
- **POST** `/auth/agent/login`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "userpassword",
    "agentId": "PC-HOSTNAME"
  }
  ```
- **Respuesta:** Tokens JWT + información del agente vinculado

---

## 📝 **Notas para el Frontend**

### Roles y Permisos
- **Admin:** Acceso completo (crear, editar, eliminar agentes y usuarios)
- **Operator:** Solo lectura y envío de comandos (no puede crear/eliminar)
- **User:** Solo puede ver datos de sus propios agentes

### Estados de Agentes
- `online`: Conectado y activo
- `offline`: Desconectado
- `maintenance`: En mantenimiento
- `error`: Error detectado
- `locked`: Bloqueado administrativamente

### Tipos de Datos (`dataType`)
- `sensor`: Datos genéricos del agente
- `system_status`: Estado general del sistema
- `performance`: CPU, RAM, disco
- `network`: Tráfico de red
- `processes`: Procesos en ejecución
- `user_activity`: Actividad del usuario
- `hardware`: Estado del hardware
- `alert`: Alertas del sistema
- `log`: Logs del sistema

### Prioridades
- `low`, `normal`, `high`, `urgent`

### Campos de Respuesta Típicos

**Agente:**
```json
{
  "_id": "ObjectId",
  "agentId": "PC-HOSTNAME",
  "name": "Mi PC",
  "description": "Descripción",
  "status": "online",
  "lastSeen": "2025-10-13T17:23:12.000Z",
  "user": {
    "username": "admin",
    "email": "admin@example.com",
    "name": "Admin",
    "surname": "User"
  },
  "location": "Oficina Principal"
}
```

**Datos:**
```json
{
  "_id": "ObjectId",
  "agentId": "PC-HOSTNAME",
  "data": { "cpu": 45, "memory": 60 },
  "dataType": "performance",
  "priority": "normal",
  "tags": ["monitoring"],
  "createdAt": "2025-10-13T17:23:12.000Z",
  "agent": {
    "name": "Mi PC",
    "agentId": "PC-HOSTNAME",
    "location": "Oficina Principal"
  }
}
```