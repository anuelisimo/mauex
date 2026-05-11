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
echo   4. Desplegar Worker en Cloudflare
echo   5. Instalar soporte IBKR en Oracle
echo   6. Probar Oracle y Cloudflare
echo.
echo Si algun servicio pide login o una private key, te lo va a pedir en esta misma ventana.
echo.

echo Revisando app y Worker...
node --check app.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check worker.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check oracle-binance-backend\mauex-binance-backend.js
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
call "%~dp0SUBIR_BACKEND_MAUEX_A_GITHUB.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 3/5 - Worker Cloudflare
echo ============================================
call "%~dp0DESPLEGAR_WORKER_CLOUDFLARE.bat"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude desplegar Cloudflare automaticamente.
  echo Voy a copiar el Worker al portapapeles para que puedas pegarlo manualmente.
  call "%~dp0COPIAR_WORKER_CLOUDFLARE.bat"
)

echo.
echo ============================================
echo   Paso 4/5 - Oracle / IBKR
echo ============================================
call "%~dp0INSTALAR_IBKR_ORACLE_MAUEX.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Paso 5/5 - Prueba final
echo ============================================
call "%~dp0PROBAR_IBKR_MAUEX.bat"

echo.
echo ============================================
echo   Listo
echo ============================================
echo.
echo La actualizacion completa termino.
echo Si Cloudflare no se desplego automatico, el Worker quedo copiado al portapapeles.
echo En ese caso pegalo en Cloudflare Workers y toca Deploy.
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
