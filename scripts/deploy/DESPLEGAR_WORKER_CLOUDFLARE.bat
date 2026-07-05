@echo off
setlocal

cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - desplegar Worker en Cloudflare
echo ============================================
echo.
echo.
echo IMPORTANTE:
echo Este despliegue por Wrangler queda desactivado por seguridad.
echo Si se usa sin bindings, Cloudflare puede quedar sin KV ni variables,
echo y se rompe Capital / Dashboard / Signals.
echo.
echo Usa este archivo en su lugar:
echo   COPIAR_WORKER_CLOUDFLARE.bat
echo.
echo Luego pega el codigo en Cloudflare ^> Workers ^& Pages ^> mauex-proxy ^> Edit code ^> Deploy.
echo No borres las Variables, Secrets ni el binding MAUEX_CACHE.
echo.
if not "%MAUEX_AUTO%"=="1" pause
exit /b 1
