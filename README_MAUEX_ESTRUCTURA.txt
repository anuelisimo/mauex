MAUex - estructura del frontend

Version estable local:
- index_STABLE_2026-05-07.html

Archivos que usa Vercel para la app:
- index.html: pantalla y estructura principal.
- styles.css: estilos visuales de la app.
- firebase.js: login, Firebase, Firestore y datos del usuario.
- app.js: logica de dashboard, trades, historial, precios, alertas y settings.

Para subir cambios del frontend:
1. Ejecutar SUBIR_MAUEX_A_GITHUB.bat
2. Esperar que Vercel haga el deploy automatico.

Para actualizar Cloudflare Worker:
1. Ejecutar COPIAR_WORKER_CLOUDFLARE.bat
2. Pegar en Cloudflare Worker y tocar Deploy.

Para actualizar Oracle:
1. Ejecutar el instalador correspondiente:
   - INSTALAR_BINANCE_ORACLE_MAUEX.bat
   - INSTALAR_KUCOIN_ORACLE_MAUEX.bat

Nota:
El Worker y Oracle no forman parte del frontend de Vercel. Conviene mantenerlos separados para evitar mezclar despliegues.
