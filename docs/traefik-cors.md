# CORS y WebSockets detrás de Traefik

Este backend ya expone CORS dinámico mediante variables de entorno `CORS_ORIGINS` y `CORS_CREDENTIALS` y ajusta Socket.io con la misma política.

Cuando se despliega detrás de Traefik, normalmente no hace falta que Traefik inyecte cabeceras CORS si la app ya las envía. Sin embargo, si quieres manejar CORS desde Traefik o necesitas habilitar WebSocket a través del proxy, aquí tienes ejemplos.

## 1) Traefik v2: Middleware de headers (CORS)

```yaml
http:
  middlewares:
    prometeo-cors:
      headers:
        accessControlAllowOriginList:
          - "https://app.tu-dominio.com"
          - "https://admin.tu-dominio.com"
        accessControlAllowMethods:
          - GET
          - POST
          - PUT
          - PATCH
          - DELETE
          - OPTIONS
        accessControlAllowHeaders:
          - Authorization
          - Content-Type
        accessControlAllowCredentials: true
        accessControlMaxAge: 86400
```

Luego aplica el middleware a tu router:

```yaml
http:
  routers:
    prometeo-api:
      rule: "Host(`api.tu-dominio.com`) && PathPrefix(`/`)"
      entryPoints: ["websecure"]
      service: prometeo-svc
      middlewares:
        - prometeo-cors
      tls:
        certResolver: letsencrypt
```

Si usas labels en Docker Compose:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.prometeo.rule=Host(`api.tu-dominio.com`)"
  - "traefik.http.routers.prometeo.entrypoints=websecure"
  - "traefik.http.routers.prometeo.tls.certresolver=letsencrypt"
  - "traefik.http.middlewares.prometeo-cors.headers.accessControlAllowOriginList=https://app.tu-dominio.com,https://admin.tu-dominio.com"
  - "traefik.http.middlewares.prometeo-cors.headers.accessControlAllowMethods=GET,POST,PUT,PATCH,DELETE,OPTIONS"
  - "traefik.http.middlewares.prometeo-cors.headers.accessControlAllowHeaders=Authorization,Content-Type"
  - "traefik.http.middlewares.prometeo-cors.headers.accessControlAllowCredentials=true"
  - "traefik.http.routers.prometeo.middlewares=prometeo-cors@docker"
```

Nota: Si activas `CORS_CREDENTIALS=true` en el backend y necesitas cookies/sesión, no uses `*` en `Allow-Origin`; especifica dominios concretos.

## 2) WebSocket con Traefik

Socket.io usa WebSocket/long-polling. Traefik v2 lo soporta por defecto, pero asegúrate de:

- Usar el mismo host/origen permitido en `CORS_ORIGINS`.
- Terminar TLS si corresponde (`websecure`).
- No añadir compresión a websockets en Traefik (opcional).

Ejemplo label extra (normalmente no es necesario):

```yaml
labels:
  - "traefik.http.services.prometeo-svc.loadbalancer.server.port=3000"
  - "traefik.http.routers.prometeo.service=prometeo-svc"
```

## 3) Variables de entorno del backend

- `CORS_ORIGINS`: `https://app.tu-dominio.com,/https:\/\/.*\\.tu-dominio\\.com$/`
- `CORS_CREDENTIALS`: `true|false`
- `TRUST_PROXY`: `true` si corre detrás de Traefik

## 4) Errores comunes

- 403/blocked by CORS policy: El origen real no está incluido en `CORS_ORIGINS`.
- Preflight OPTIONS 200 pero GET/POST falla: Traefik añade o quita cabeceras. Desactiva CORS en Traefik o alinea las listas.
- Socket.io CORS mismatch: Revisa logs de arranque, el backend imprime orígenes permitidos para HTTP y WS.
