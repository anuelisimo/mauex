MAUex - estructura del repo

Estructura principal:
- frontend/: app web de Vercel.
- worker/: Cloudflare Worker mauex-proxy.
- server/: backend Railway.
- oracle/: backend Oracle y telegram-reader.
- colony/: investigacion/backtesting.
- scripts/legacy/: scripts viejos de fixes puntuales, conservados solo como referencia.
- firestore.rules: reglas de Firestore.

Archivos que usa Vercel para la app:
- frontend/index.html: pantalla y estructura principal.
- frontend/styles.css: estilos visuales de la app.
- frontend/firebase.js: login, Firebase, Firestore y datos del usuario.
- frontend/app.js: logica de dashboard, trades, historial, precios, alertas y settings.
- vercel.json: reescribe rutas para servir frontend/ desde la raiz.

Para subir cambios del frontend:
1. Ejecutar SUBIR_MAUEX_A_GITHUB.bat
2. Esperar que Vercel haga el deploy automatico.

Para actualizar Cloudflare Worker:
1. Preferido: GitHub Actions con .github/workflows/deploy-worker.yml.
2. Fallback manual: ejecutar COPIAR_WORKER_CLOUDFLARE.bat, pegar en Cloudflare Worker y tocar Deploy.

Para actualizar Oracle:
1. Ejecutar el instalador correspondiente:
   - INSTALAR_BINANCE_ORACLE_MAUEX.bat
   - INSTALAR_KUCOIN_ORACLE_MAUEX.bat

Nota:
El Worker, Railway y Oracle no forman parte del frontend de Vercel. Mantenerlos separados evita mezclar despliegues.
