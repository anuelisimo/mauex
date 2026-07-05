# MAUex - Operacion Fase 1

Fecha: 2026-07-05

## Estado

Fase 0 quedo activa:

- Worker protegido con `MAUEX_API_TOKEN`.
- `/health` publico y reducido.
- Endpoints de datos con `Authorization: Bearer <MAUEX_API_TOKEN>`.
- Frontend guarda el token en `localStorage` como `mauex_api_token`.
- Railway y Oracle esperan el mismo token.
- Firestore Rules viven en `firestore.rules`.

## Estructura

La Fase 1 deja el proyecto separado asi:

```txt
frontend/
worker/
server/
oracle/
colony/
scripts/legacy/
firestore.rules
```

- `frontend/`: app web que sirve Vercel.
- `worker/`: Cloudflare Worker `mauex-proxy`.
- `server/`: backend Railway.
- `oracle/`: backend Oracle y telegram-reader.
- `scripts/legacy/`: scripts viejos de fixes puntuales, conservados como referencia.

`vercel.json` permite que Vercel siga sirviendo la app desde la raiz aunque los archivos vivan en `frontend/`.

## Checks diarios

Ejecutar:

```bat
PROBAR_SALUD_MAUEX.bat
```

Debe mostrar:

- `Worker /health`: HTTP 200.
- `Worker /balance sin token`: HTTP 401.
- `Worker /balance con token`: HTTP 200.

Si `MAUEX_API_KEYS.txt` tiene `RAILWAY_URL` o `BINANCE_BACKEND_URL`, tambien prueba esos servicios con token.

Si aparece HTTP 429, la respuesta viene de Cloudflare antes de entrar al Worker. Esperar unos minutos y volver a correr el check.

## Deploy Worker por GitHub Actions

Se agrego:

```txt
.github/workflows/deploy-worker.yml
wrangler.jsonc
worker/worker.js
```

Para que funcione, en GitHub hay que crear este secret:

```txt
CLOUDFLARE_API_TOKEN
```

El token de Cloudflare debe poder desplegar el Worker `mauex-proxy`.

El workflow corre cuando cambia:

- `worker/worker.js`
- `wrangler.jsonc`
- `.github/workflows/deploy-worker.yml`

Tambien se puede ejecutar manualmente desde la pestana Actions.

## Firestore Rules

Se agrego:

```txt
firebase.json
firestore.rules
```

Deploy manual:

```bat
npx --cache ".\.npm-cache" firebase-tools deploy --only firestore:rules --project TU_FIREBASE_PROJECT_ID
```

## Validaciones esperadas despues de subir/deployar

- GitHub Actions despliega Worker correctamente.
- Vercel despliega frontend correctamente.
- Railway toma el backend actualizado.
- `PROBAR_SALUD_MAUEX.bat` queda verde despues de un deploy completo.
