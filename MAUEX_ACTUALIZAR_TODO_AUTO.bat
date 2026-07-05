@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"
set "MAUEX_AUTO=1"

echo.
echo ============================================
echo   MAUex - actualizacion completa automatica
echo ============================================
echo.
echo Este archivo intenta hacer todo en una sola corrida:
echo   1. Revisar archivos principales
echo   2. Subir frontend a GitHub / Vercel
echo   3. Subir backend y Worker a GitHub
echo   4. Copiar Worker para Cloudflare
echo   5. Instalar soporte IBKR en Oracle
echo   6. Probar Oracle y Cloudflare
echo.
echo Si algun servicio pide login o una private key, te lo va a pedir en esta misma ventana.
echo Cloudflare queda manual: el Worker se copia al portapapeles para pegarlo y tocar Deploy.
echo.

echo Revisando app y Worker...
node --check frontend\app.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check frontend\firebase.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check worker\worker.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check server\server.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check oracle\mauex-binance-backend.js
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 1/5 - Frontend GitHub / Vercel
echo ============================================
call "%~dp0SUBIR_MAUEX_A_GITHUB.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 2/5 - Backend repo GitHub
echo ============================================
call "%~dp0scripts\deploy\SUBIR_BACKEND_MAUEX_A_GITHUB.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 3/5 - Worker Cloudflare
echo ============================================
echo Para evitar que Wrangler bloquee la actualizacion, no intento login automatico.
echo Copio el Worker al portapapeles para que lo pegues en Cloudflare.
call "%~dp0scripts\deploy\COPIAR_WORKER_CLOUDFLARE.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 4/5 - Oracle / IBKR
echo ============================================
call "%~dp0scripts\setup\INSTALAR_IBKR_ORACLE_MAUEX.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 5/5 - Prueba final
echo ============================================
call "%~dp0scripts\diagnostics\PROBAR_IBKR_MAUEX.bat"

echo.
echo ============================================
echo   Listo
echo ============================================
echo.
echo La actualizacion completa termino.
echo El Worker quedo copiado al portapapeles.
echo Pegalo en Cloudflare Workers y toca Deploy.
echo.
pause
exit /b 0

:FAIL
echo.
echo ============================================
echo   Se freno la actualizacion
echo ============================================
echo.
echo Deja esta ventana abierta y mandale captura a Codex.
echo.
pause
exit /b 1
