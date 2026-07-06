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
- `frontend/helpers.js` como segundo corte real desde `app.js`
- `frontend/nav.js` como tercer corte real desde `app.js`
- `frontend/themes.js` como cuarto corte real desde `app.js`
- `frontend/signals.js` como quinto corte real desde `app.js`
- `frontend/calc.js` como sexto corte real desde `app.js`
- `frontend/dashboard.js`, `frontend/watchlist.js` y `frontend/positions.js` como cortes siguientes desde `app.js`
- `frontend/history.js` y `frontend/analysis.js` separados desde `app.js`
- `frontend/exchange-keys.js`, `frontend/orders.js` e `frontend/init.js` separados desde `app.js`

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
2. `helpers.js`: formatos, crypto-neutral helpers, tooltips, modals, `toast`, `esc`. **Parcial: helpers iniciales, tooltips, modales y toast movidos. `esc` unico queda para 3.3.**
3. `nav.js`: `PAGES`, `showPage`, tabs y estado operativo. **Hecho.**
4. `themes.js`: temas y selector. **Hecho.**
5. `signals.js`: Signal Desk completo. **Hecho.**
6. `calc.js`: calculadora y charts embebidos de calculadora. **Hecho.**
7. `dashboard.js`: capital, liquidez, metricas y PDF. **Hecho.**
8. `watchlist.js`: watchlist, bulk actions y cards. **Hecho.**
9. `positions.js`: posiciones, alertas y mapa de riesgo. **Hecho.**
10. `history.js`: historial, filtros y CSV. **Hecho.**
11. `analysis.js`: charts/AI analysis. **Hecho.**
12. `exchange-keys.js`: crypto helpers, master pass, API keys y exchange sync. **Hecho.**
13. `orders.js`: ordenes manuales y exchange orders. **Hecho.**
14. `init.js`: bootstrapping final. **Hecho.**

## Regla de migracion

- Mover codigo sin cambiar logica.
- Mantener `window.xxx` para todo handler usado por HTML.
- En cada tanda: `npm.cmd run check`, diagnostico local y prueba manual de la pantalla tocada.
- No cambiar Firebase CDN a paquete npm hasta que Vite build sea el camino de deploy.

## 3.2 Styles inline

Hecho para `index.html`.

- `index.html` quedo sin `style="..."`.
- Se generaron clases `.ixs-*` en `frontend/styles.css` para conservar paridad visual sin tocar layout.
- Pendiente visual recomendado: comparar screenshots logueado despues del deploy.

## 3.3 Higiene XSS

En progreso.

Hecho:

- `esc()` unico creado en `frontend/helpers.js` y expuesto como `window.esc`.
- `jsArg()` creado en `frontend/helpers.js` para argumentos de `onclick` generados por templates.
- `signalEsc`, `operationalStatusEscape`, `dashSafe` y el escape local de `firebase.js` conectados al helper unico.
- Tickers, traders, notas, exchanges, mensajes de error y dropdowns principales pasan por `esc()`/`dashSafe()`/`signalEsc()` en las zonas auditadas.

Regla:

- Crear un `esc()` unico en helpers.
- Todo texto que venga de usuario, exchange, Telegram o CSV pasa por `esc()`.
- Numeros formateados pueden quedar sin escape si no incorporan texto externo.

## 3.4 Modal 2

Hecho.

Objetivo:

- `saveExchangeKeys` / `saveExchangeKeys2` usan `saveExchangeKeysWithSuffix(exchange, suffix)`.
- `saveMasterPass` / `saveMasterPass2` usan `saveMasterPassWithSuffix(suffix)`.
- Se conservaron los nombres publicos porque el HTML actual los llama con `onclick`.
