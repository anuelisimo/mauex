@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"
set "MAUEX_AUTO=1"

echo.
echo ============================================
echo   MAUex - subir fix Dashboard / Worker
echo ============================================
echo.
echo Este archivo hace solo lo necesario para este arreglo:
echo   1. Revisa frontend/app.js y worker/worker.js
echo   2. Sube frontend a GitHub / Vercel
echo   3. Sube backend/Worker al repo backend
echo   4. Copia el Worker actualizado para pegarlo en Cloudflare
echo.

echo Usando worker/worker.js actual. No copio archivos historicos encima.

node --check frontend\app.js
if %ERRORLEVEL% NEQ 0 goto FAIL

node --check worker\worker.js
if %ERRORLEVEL% NEQ 0 goto FAIL

call "%~dp0SUBIR_MAUEX_A_GITHUB.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

call "%~dp0SUBIR_BACKEND_MAUEX_A_GITHUB.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

call "%~dp0COPIAR_WORKER_CLOUDFLARE.bat"
if %ERRORLEVEL% NEQ 0 goto FAIL

echo.
echo ============================================
echo   Listo
echo ============================================
echo.
echo Ahora pega el Worker en Cloudflare y toca Deploy.
echo Despues recarga MAUex con Ctrl+F5.
echo.
pause
exit /b 0

:FAIL
echo.
echo Se freno el proceso. Deja esta ventana abierta y mandale captura a Codex.
echo.
pause
exit /b 1
