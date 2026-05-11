@echo off
setlocal

set "SOURCE_DIR=C:\Users\mauap\Downloads\MauEX"
set "BACKEND_DIR=C:\Users\mauap\Downloads\mauex-backend-upload"
set "BACKEND_REPO=https://github.com/anuelisimo/mauex-backend.git"

echo.
echo ============================================
echo   MAUex - subir backend/worker a GitHub
echo ============================================
echo.
echo Repo destino: anuelisimo/mauex-backend
echo.

if not exist "%SOURCE_DIR%\worker.js" (
  echo No encontre "%SOURCE_DIR%\worker.js"
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

if not exist "%BACKEND_DIR%\.git" (
  echo Clonando repo backend...
  git clone "%BACKEND_REPO%" "%BACKEND_DIR%"
  if %ERRORLEVEL% NEQ 0 (
    echo.
    echo No pude clonar el repo backend. Mandale captura de esta ventana a Codex.
    if not "%MAUEX_AUTO%"=="1" pause
    exit /b 1
  )
)

cd /d "%BACKEND_DIR%"

echo.
echo Trayendo ultima version de GitHub...
git pull --rebase origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude traer la ultima version. Mandale captura de esta ventana a Codex.
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

echo.
echo Copiando Worker y backend Oracle corregidos al repo backend...
copy /Y "%SOURCE_DIR%\worker.js" "%BACKEND_DIR%\worker.js" >nul
if not exist "%BACKEND_DIR%\oracle-binance-backend" mkdir "%BACKEND_DIR%\oracle-binance-backend"
copy /Y "%SOURCE_DIR%\oracle-binance-backend\mauex-binance-backend.js" "%BACKEND_DIR%\oracle-binance-backend\mauex-binance-backend.js" >nul
copy /Y "%SOURCE_DIR%\oracle-binance-backend\instalar-en-oracle.sh" "%BACKEND_DIR%\oracle-binance-backend\instalar-en-oracle.sh" >nul

git add worker.js
git add oracle-binance-backend
git diff --cached --quiet
if %ERRORLEVEL% EQU 0 (
  echo.
  echo No hay cambios nuevos en worker.js para subir.
  echo Igual intento subir por si habia commits pendientes.
  goto PUSH
)

git commit -m "Add IBKR balance support"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude crear el commit del backend. Mandale captura de esta ventana a Codex.
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

:PUSH
git push origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude subir el backend a GitHub. Mandale captura de esta ventana a Codex.
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

echo.
echo Listo. Worker/backend subidos al repo mauex-backend.
echo Si Cloudflare esta conectado a este repo, deberia desplegarse.
echo Si Cloudflare NO esta conectado, hay que pegar el Worker que copia COPIAR_WORKER_CLOUDFLARE.bat.
echo.
if not "%MAUEX_AUTO%"=="1" pause
