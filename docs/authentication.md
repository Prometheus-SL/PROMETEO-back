# Autenticación - PROMETEO Backend

## 🔐 Sistema de Autenticación

El backend utiliza **JWT (JSON Web Tokens)** para autenticación con refresh tokens para mayor seguridad.

### Roles de Usuario

- **admin**: Acceso completo al sistema
- **operator**: Puede ver y controlar agentes
- **viewer**: Solo lectura de datos

## 🚀 Configuración Inicial

### 1. Instalar MongoDB

```bash
# Windows con Chocolatey
choco install mongodb

# macOS con Homebrew
brew install mongodb-community

# Linux (Ubuntu/Debian)
sudo apt-get install mongodb
```

### 2. Configurar Variables de Entorno

```bash
cp .env.example .env
# Editar .env con tus configuraciones
```

### 3. Crear Usuario Administrador

```bash
npm run setup:admin
```

### 4. Crear Agentes de Ejemplo

```bash
npm run setup:agent
```

### 5. Configurar Todo

```bash
npm run setup:all
```

## 🔑 Endpoints de Autenticación

### POST /auth/login

Iniciar sesión con credenciales.

**Request:**

```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "username": "admin",
      "email": "admin@prometeo.com",
      "role": "admin"
    },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresIn": "15m"
    }
  }
}
```

### POST /auth/register

Registrar nuevo usuario.

**Request:**

```json
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "password123",
  "role": "viewer"
}
```

### GET /auth/me

Obtener información del usuario actual (requiere token).

**Headers:**

```
Authorization: Bearer <access_token>
```

### POST /auth/refresh

Renovar access token usando refresh token.

**Request:**

```json
{
  "refreshToken": "eyJ..."
}
```

### POST /auth/logout

Cerrar sesión y revocar tokens.

**Request:**

```json
{
  "refreshToken": "eyJ..."
}
```

## 🛡️ Protección de Rutas

### Middleware de Autenticación

```javascript
// Requiere token válido
app.use("/api/protected", authenticateToken);

// Requiere rol específico
app.use("/api/admin", authenticateToken, authorizeRole("admin"));

// Múltiples roles
app.use("/api/control", authenticateToken, authorizeRole("admin", "operator"));
```

### Autenticación de Agentes

Los agentes usan **API Keys** para autenticarse:

**Headers:**

```
X-API-Key: <agent_api_key>
X-Agent-ID: <agent_id>
```

## 📊 Endpoints Protegidos

### GET /api/v1/agents

**Roles:** admin, operator
Listar agentes conectados.

### GET /api/v1/stats

**Roles:** admin, operator
Estadísticas del servidor.

### POST /api/v1/agents/command

**Roles:** admin, operator
Enviar comandos a agentes.

### GET /api/v1/data/latest

**Roles:** admin, operator, viewer
Obtener últimos datos.

### POST /api/v1/agents

**Roles:** admin
Registrar nuevo agente.

### POST /api/v1/agents/data

**Autenticación:** API Key de agente
Enviar datos desde agente.

## 🔧 Configuración JWT

Variables de entorno importantes:

```env
JWT_SECRET=tu_secret_super_seguro
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=tu_refresh_secret_super_seguro
JWT_REFRESH_EXPIRES_IN=7d
```

## 🌐 Uso desde Frontend

### JavaScript/Fetch

```javascript
// Login
const login = async (username, password) => {
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json();
  if (data.success) {
    localStorage.setItem("accessToken", data.data.tokens.accessToken);
    localStorage.setItem("refreshToken", data.data.tokens.refreshToken);
  }
  return data;
};

// API call con token
const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem("accessToken");

  const response = await fetch(endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Token expirado, intentar refresh
    await refreshToken();
    // Reintentar la llamada
  }

  return response.json();
};
```

### React/Axios

```javascript
import axios from "axios";

// Interceptor para agregar token automáticamente
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor para manejar tokens expirados
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Intentar refresh token
      try {
        await refreshToken();
        // Reintentar la petición original
        return axios.request(error.config);
      } catch {
        // Redirect a login
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
```

## 🔒 Seguridad

### Rate Limiting

- **Login:** 5 intentos por IP cada 15 minutos
- **Register:** 3 registros por IP cada hora

### Tokens

- **Access Token:** 15 minutos de vida
- **Refresh Token:** 7 días de vida
- Los refresh tokens se almacenan en BD y se pueden revocar

### Passwords

- Hasheadas con bcrypt (12 rounds)
- Mínimo 6 caracteres

### Headers de Seguridad

- Helmet.js activado
- CORS configurado
- Compresión activada

## 🧪 Testing

### Crear Usuario de Prueba

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"test123"}'
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### Acceder a Endpoint Protegido

```bash
curl -X GET http://localhost:3000/api/v1/stats \
  -H "Authorization: Bearer <access_token>"
```
