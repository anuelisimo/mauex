# MAUex - Fase 3 Frontend

Fecha: 2026-07-05

## Objetivo

Ordenar el frontend sin cambiar comportamiento visible. La regla principal de esta fase es mover codigo con el menor riesgo posible: los handlers `window.xxx` se mantienen porque el HTML actual usa `onclick` inline.

## Estado inicial

- `frontend/app.js`: archivo principal grande, mas de 11k lineas.
- `frontend/firebase.js`: modulo ES que hoy importa Firebase desde CDN.
- `frontend/index.html`: mantiene HTML actual y carga `firebase.js` como modulo, `app.js` como script clasico.
- `frontend/styles.css`: estilos globales.

## 3.1 Vite

Preparado:

- `frontend/package.json`
- `frontend/vite.config.js`
- `frontend/proxy.js` como primer corte real desde `app.js`

Esto permite correr Vite en `frontend/` sin cambiar todavia el deploy estatico actual.

Pendiente para completar el cambio a bundle:

1. Instalar dependencias en `frontend/`.
2. Cambiar imports de `firebase.js` desde CDN a paquete npm:
   - `firebase/app`
   - `firebase/auth`
   - `firebase/firestore`
3. Cambiar el HTML para cargar un entrypoint Vite.
4. Ajustar Vercel para publicar `frontend/dist` o correr `vite build`.

## 3.1 Split propuesto

El split no debe hacerse en un solo commit. `app.js` comparte muchas variables de scope entre secciones; mover a modulos ES rompe esas referencias si no se exportan/importan o si no se conservan en `window`.

Orden recomendado:

1. `proxy.js`: `PROXY_URL`, `WORKER_API_TOKEN_KEY`, `workerFetch`, `proxyFetch`, `publicFetch`. **Hecho.**
2. `helpers.js`: formatos, crypto-neutral helpers, tooltips, modals, `toast`, `esc`.
3. `nav.js`: `PAGES`, `showPage`, tabs y estado operativo.
4. `themes.js`: temas y selector.
5. `signals.js`: Signal Desk completo.
6. `calc.js`: calculadora y charts embebidos de calculadora.
7. `dashboard.js`: capital, liquidez, metricas y PDF.
8. `watchlist.js`: watchlist, bulk actions y cards.
9. `positions.js`: posiciones, alertas y mapa de riesgo.
10. `history.js`: historial, filtros y CSV.
11. `analysis.js`: charts/AI analysis.
12. `exchange-keys.js`: crypto helpers, master pass, API keys y exchange sync.
13. `orders.js`: ordenes manuales y exchange orders.
14. `init.js`: bootstrapping final.

## Regla de migracion

- Mover codigo sin cambiar logica.
- Mantener `window.xxx` para todo handler usado por HTML.
- En cada tanda: `npm.cmd run check`, diagnostico local y prueba manual de la pantalla tocada.
- No cambiar Firebase CDN a paquete npm hasta que Vite build sea el camino de deploy.

## 3.2 Styles inline

Pendiente. Requiere screenshots antes/despues.

Prioridad:

1. Mover estilos inline repetidos de cards, botones chicos y labels.
2. Dejar estilos de layout unico para una segunda pasada.
3. Comparar visualmente Dashboard, Settings, Signal Desk, Calculadora y Positions.

## 3.3 Higiene XSS

Pendiente. Ya existe escape local en varias zonas y `firebase.js` tiene un `esc`.

Regla:

- Crear un `esc()` unico en helpers.
- Todo texto que venga de usuario, exchange, Telegram o CSV pasa por `esc()`.
- Numeros formateados pueden quedar sin escape si no incorporan texto externo.

## 3.4 Modal 2

Pendiente.

Objetivo:

- Unificar `saveExchangeKeys` / `saveExchangeKeys2`.
- Unificar `saveMasterPass` / `saveMasterPass2`.
- Usar un sufijo de IDs: `suffix=''` o `suffix='2'`.
