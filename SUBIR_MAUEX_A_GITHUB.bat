@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - subir cambios a GitHub
echo ============================================
echo.

git status
echo.

echo Preparando archivos del frontend...
if exist frontend\index.html git add frontend\index.html
if exist frontend\styles.css git add frontend\styles.css
if exist frontend\firebase.js git add frontend\firebase.js
if exist frontend\app.js git add frontend\app.js
if exist vercel.json git add vercel.json
if exist wrangler.jsonc git add wrangler.jsonc
if exist firebase.json git add firebase.json
if exist firestore.rules git add firestore.rules
if exist package.json git add package.json
if exist railway.toml git add railway.toml
if exist worker\worker.js git add worker\worker.js
if exist server\server.js git add server\server.js
if exist server\package.json git add server\package.json
if exist server\railway.toml git add server\railway.toml
if exist oracle\mauex-binance-backend.js git add oracle\mauex-binance-backend.js
if exist oracle\instalar-en-oracle.sh git add oracle\instalar-en-oracle.sh
if exist .github\workflows\deploy-worker.yml git add .github\workflows\deploy-worker.yml
if exist README_MAUEX_ESTRUCTURA.txt git add README_MAUEX_ESTRUCTURA.txt
if exist OPERACION_MAUEX_FASE1.md git add OPERACION_MAUEX_FASE1.md
if exist PROBAR_SALUD_MAUEX.bat git add PROBAR_SALUD_MAUEX.bat
if exist PROBAR_SALUD_MAUEX.ps1 git add PROBAR_SALUD_MAUEX.ps1
if exist SUBIR_MAUEX_A_GITHUB.bat git add SUBIR_MAUEX_A_GITHUB.bat
if exist SUBIR_BACKEND_MAUEX_A_GITHUB.bat git add SUBIR_BACKEND_MAUEX_A_GITHUB.bat
if exist MAUEX_ACTUALIZAR_TODO.bat git add MAUEX_ACTUALIZAR_TODO.bat
if exist MAUEX_ACTUALIZAR_TODO_AUTO.bat git add MAUEX_ACTUALIZAR_TODO_AUTO.bat
if exist MAUEX_SUBIR_FIX_DASH_WORKER.bat git add MAUEX_SUBIR_FIX_DASH_WORKER.bat
if exist COPIAR_WORKER_CLOUDFLARE.bat git add COPIAR_WORKER_CLOUDFLARE.bat
if exist INSTALAR_IBKR_ORACLE_MAUEX.bat git add INSTALAR_IBKR_ORACLE_MAUEX.bat
if exist INSTALAR_IBKR_ORACLE_MAUEX.ps1 git add INSTALAR_IBKR_ORACLE_MAUEX.ps1
if exist PROBAR_IBKR_MAUEX.bat git add PROBAR_IBKR_MAUEX.bat
if exist PROBAR_IBKR_MAUEX.ps1 git add PROBAR_IBKR_MAUEX.ps1
if exist PROBAR_CONEXIONES_DASH_MAUEX.bat git add PROBAR_CONEXIONES_DASH_MAUEX.bat
if exist PROBAR_CONEXIONES_DASH_MAUEX.ps1 git add PROBAR_CONEXIONES_DASH_MAUEX.ps1
if exist CONFIGURAR_TELEGRAM_MAUEX.bat git add CONFIGURAR_TELEGRAM_MAUEX.bat
if exist INSTALAR_TELEGRAM_READER_ORACLE_MAUEX.bat git add INSTALAR_TELEGRAM_READER_ORACLE_MAUEX.bat
if exist INSTALAR_TELEGRAM_READER_ORACLE_MAUEX.ps1 git add INSTALAR_TELEGRAM_READER_ORACLE_MAUEX.ps1
if exist PROBAR_TELEGRAM_READER_ORACLE_MAUEX.bat git add PROBAR_TELEGRAM_READER_ORACLE_MAUEX.bat
if exist PROBAR_TELEGRAM_READER_ORACLE_MAUEX.ps1 git add PROBAR_TELEGRAM_READER_ORACLE_MAUEX.ps1
if exist REINICIAR_TELEGRAM_READER_ORACLE_MAUEX.bat git add REINICIAR_TELEGRAM_READER_ORACLE_MAUEX.bat
if exist REINICIAR_TELEGRAM_READER_ORACLE_MAUEX.ps1 git add REINICIAR_TELEGRAM_READER_ORACLE_MAUEX.ps1
if exist PROBAR_WORKER_TELEGRAM_MAUEX.bat git add PROBAR_WORKER_TELEGRAM_MAUEX.bat
if exist PROBAR_WORKER_TELEGRAM_MAUEX.ps1 git add PROBAR_WORKER_TELEGRAM_MAUEX.ps1
if exist DESACTIVAR_BACKFILL_TELEGRAM_READER_MAUEX.bat git add DESACTIVAR_BACKFILL_TELEGRAM_READER_MAUEX.bat
if exist DESACTIVAR_BACKFILL_TELEGRAM_READER_MAUEX.ps1 git add DESACTIVAR_BACKFILL_TELEGRAM_READER_MAUEX.ps1
if exist ACTUALIZAR_CANALES_TELEGRAM_READER_MAUEX.bat git add ACTUALIZAR_CANALES_TELEGRAM_READER_MAUEX.bat
if exist ACTUALIZAR_CANALES_TELEGRAM_READER_MAUEX.ps1 git add ACTUALIZAR_CANALES_TELEGRAM_READER_MAUEX.ps1
if exist oracle\telegram-reader git add oracle\telegram-reader

echo Guardando cambios locales...
git commit -m "Improve signal desk Telegram automation"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Puede que no haya cambios nuevos para guardar. Sigo igual.
)

echo.
echo Trayendo la ultima version de GitHub...
set "STASHED=0"
git diff --quiet
if %ERRORLEVEL% NEQ 0 (
  echo Hay cambios locales fuera del frontend. Los guardo temporalmente para poder traer GitHub...
  git stash push -m "mauex-temp-non-frontend" -- worker\worker.js
  if %ERRORLEVEL% EQU 0 set "STASHED=1"
)

git pull --rebase origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude acomodar automaticamente los cambios con la version online.
  echo Deja esta ventana abierta y mandale una captura a Codex.
  echo.
  if "%STASHED%"=="1" git stash pop
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

if "%STASHED%"=="1" (
  echo Recuperando cambios locales no relacionados...
  git stash pop
)

echo.
echo Revisando si todavia hay cambios pendientes...
git status --short
echo.

git push origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude subir a GitHub. Puede faltar login de GitHub en esta PC.
  echo Si te aparece una ventana de GitHub, inicia sesion y volve a ejecutar este archivo.
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

echo.
echo Listo. Cambios subidos a GitHub.
echo Vercel deberia actualizar la web automaticamente en unos minutos.
echo.
if not "%MAUEX_AUTO%"=="1" pause
