# Autenticación de Agentes con JWT

Este backend ahora requiere que cada agente se autentique usando el email y contraseña de su usuario propietario. Con esto:

- Cada `agentId` queda vinculado a un usuario (owner)
- Los envíos de datos por HTTP requieren token JWT del usuario y verificación de propiedad
- Las conexiones de WebSocket de agentes también exigen token para identificar al propietario

## 1) Login del agente

HTTP

POST /auth/agent/login
Content-Type: application/json

{
  "email": "usuario@dominio.com",
  "password": "*******",
  "agentId": "PC-<HOSTNAME>"
}

Respuesta:
- tokens.accessToken: JWT para Authorization: Bearer
- tokens.refreshToken
- agent: info del agente vinculado

Si `agentId` no existe, se crea y se vincula al usuario. Si existe sin owner, se asigna al usuario. Si ya pertenece a otro usuario, devuelve 403.

## 2) Enviar datos por HTTP

HTTP

POST /api/v1/agents/data
Authorization: Bearer <accessToken>
Content-Type: application/json
x-agent-id: <AGENT_ID>

{
  "data": { "type": "performance", "cpu": 20 },
  "dataType": "sensor",
  "priority": "normal",
  "tags": ["demo"]
}

Notas:
- Es obligatorio enviar `Authorization: Bearer` y el `agentId` (header `x-agent-id` o en el body `agentId`)
- El middleware verifica que ese `agentId` pertenece al usuario del token

## 3) Conexión de WebSocket del agente

Cuando el agente se conecta por Socket.io, debe identificarse con token:

identify payload:
{ "type": "agent", "agentId": "PC-<HOSTNAME>", "token": "<accessToken>" }

El servidor valida el token y comprueba que el `agentId` pertenece a ese usuario (crea o vincula si es la primera vez). Si pertenece a otro usuario o el token es inválido, desconecta el socket.

## Flujo recomendado del agente

1. Hacer POST /auth/agent/login enviando email, password y agentId
2. Guardar `accessToken` (y opcionalmente `refreshToken`)
3. Conectar por WebSocket y enviar `token` y `agentId` en `identify`
4. Para envío HTTP a /api/v1/agents/data, usar Authorization: Bearer y `x-agent-id`

## Compatibilidad previa (API Key)

El endpoint de envío `/api/v1/agents/data` ahora requiere token. El middleware anterior por API Key se mantiene en el código, pero ya no se usa en esa ruta.
