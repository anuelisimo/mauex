MAUex - backend gratis para Binance en Oracle Cloud

Objetivo:
Este backend reemplaza Railway solo para Binance. Sirve para que Binance vea una IP fija y permita leer el balance de Futures para el dashboard.

Archivos:
- mauex-binance-backend.js: mini backend de Binance.
- instalar-en-oracle.sh: instalador para la maquina de Oracle.

Pasos generales:
1. Crear una cuenta en Oracle Cloud Free Tier.
2. Crear una maquina virtual Always Free con Ubuntu.
3. Reservar o anotar la IP publica de esa maquina.
4. Abrir el puerto 8080 en Oracle.
5. Subir esta carpeta a la maquina.
6. Ejecutar el instalador.
7. Pegar BINANCE_KEY y BINANCE_SECRET en /opt/mauex-binance/.env.
8. Reiniciar el servicio.
9. Abrir:
   http://IP_DE_ORACLE:8080/myip
   Esa IP es la que va en Binance como trusted IP.
10. Abrir:
   http://IP_DE_ORACLE:8080/binance-balance
   Si devuelve datos, Binance esta funcionando.
11. En Cloudflare Worker agregar:
   BINANCE_BACKEND_URL=http://IP_DE_ORACLE:8080

Importante:
La API key de Binance debe tener Enable Reading y Enable Futures.
Debe tener restriccion de IP activada usando la IP publica de Oracle.
