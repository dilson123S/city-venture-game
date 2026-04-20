# City Venture B2B Connect

Juego multijugador realtime con arquitectura separada para despliegue:

- frontend estatico para Vercel en `frontend/`
- backend Socket.IO en `server.js` (tambien disponible en `backend/server.js`)
- persistencia de sesion en Redis (o memoria para desarrollo)
- acceso de host por login (usuario/contrasena) en lugar de llave manual

## Estructura

- `frontend/`: cliente web (HTML/CSS/JS + tablero SVG)
- `backend/server.js`: entrada alternativa del backend para despliegues tipo servicio
- `server.js`: backend realtime principal
- `game-data.js`: tablero, roles, cartas y catalogos
- `smoke-test.js`: prueba E2E automatica

## Variables de entorno

Ejemplo listo para copiar: `backend/.env.example`

- `PORT`: puerto del backend (default `3000`)
- `FRONTEND_PORT`: puerto esperado del frontend en local (default `4173`)
- `FRONTEND_URL`: URL publica del frontend (ej: `https://tu-app.vercel.app`)
- `PUBLIC_BACKEND_URL`: URL publica del backend (ej: `https://city-venture-api.onrender.com`)
- `SESSION_STORE_DRIVER`: `redis` o `memory` (default `redis` si hay `REDIS_URL`, si no `memory`)
- `REDIS_URL`: cadena de conexion Redis (obligatoria en produccion)
- `REDIS_SESSION_KEY`: clave Redis para la sesion (default `city-venture:session:v1`)
- `HOST_LOGIN_USERNAME`: usuario del login host (default `admin`)
- `HOST_LOGIN_PASSWORD`: contrasena del login host (default `cityventure123`)
- `NEGOTIATION_SECONDS`: duracion de fase B2B
- `LEGACY_SAVE_PATH`: ruta opcional para migrar una sesion antigua en archivo JSON

## Ejecutar en local (frontend + backend separados)

1. Instala dependencias:

```bash
npm install
```

2. Terminal 1, backend:

```bash
$env:SESSION_STORE_DRIVER="memory"; npm run start:backend
```

3. Terminal 2, frontend:

```bash
npm run start:frontend
```

4. Abre:

```text
http://localhost:4173
```

## Deploy Checklist (Vercel + backend realtime + Redis)

1. Crea Redis administrado (Upstash, Redis Cloud, Railway Redis, etc.) y guarda `REDIS_URL`.
2. Despliega backend (Render/Railway/Fly/otro) usando este comando de inicio:

```bash
node backend/server.js
```

3. Configura variables del backend:

```text
PORT=3000
SESSION_STORE_DRIVER=redis
REDIS_URL=<tu_redis_url>
REDIS_SESSION_KEY=city-venture:session:v1
FRONTEND_URL=https://<tu-frontend>.vercel.app
PUBLIC_BACKEND_URL=https://<tu-backend>.onrender.com
HOST_LOGIN_USERNAME=admin
HOST_LOGIN_PASSWORD=<cambia-esta-contrasena>
NEGOTIATION_SECONDS=60
```

4. Con Vercel CLI, vincula y despliega el frontend:

```bash
npx vercel link --cwd frontend
npx vercel --prod --cwd frontend
```

5. Si no deseas usar CLI, en dashboard de Vercel configura Root Directory = `frontend` y despliega.
6. Verifica en juego host que los links de invitacion apunten al dominio Vercel.
7. Verifica en juego host que cada link incluya `backend=` con la URL del backend.
8. Prueba login host con el usuario configurado y la contrasena correcta.

## Comandos de verificacion

```bash
npm test
```

El smoke test valida flujo base, takeover block, login de host, expiracion por timer, migracion legacy y rate limit.
