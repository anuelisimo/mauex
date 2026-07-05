# MAUex frontend modules

Carpeta reservada para la migracion gradual de `app.js`.

No mover codigo aca sin validar cada corte. La app actual depende de handlers globales (`window.xxx`) usados desde `onclick` inline en `index.html`.

Orden sugerido:

1. `proxy.js`
2. `helpers.js`
3. `nav.js`
4. `themes.js`
5. `signals.js`
6. `calc.js`
7. `dashboard.js`
8. `watchlist.js`
9. `positions.js`
10. `history.js`
11. `analysis.js`
12. `exchange-keys.js`
13. `orders.js`
14. `init.js`
