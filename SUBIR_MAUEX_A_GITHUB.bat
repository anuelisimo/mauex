@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - subir cambios a GitHub
echo ============================================
echo.

if not exist ".git" (
  echo No encontre la carpeta .git. Ejecuta este BAT desde la carpeta MauEX.
  pause
  exit /b 1
)

set "ME=%USERDOMAIN%\%USERNAME%"
echo Corrigiendo permisos de Git...
icacls ".git" /remove:d "LegionMau\CodexSandboxUsers" >nul 2>nul
icacls ".git" /remove:d "LegionMau\codexsandboxoffline" >nul 2>nul
icacls ".git" /remove:d *S-1-5-21-4070875099-3014453175-1194438234-2994042337 >nul 2>nul
icacls ".git" /grant "%ME%:(OI)(CI)F" /T /C >nul
icacls ".git" /grant "LegionMau\CodexSandboxUsers:(OI)(CI)M" /T /C >nul 2>nul
icacls ".git" /grant "LegionMau\codexsandboxoffline:(OI)(CI)M" /T /C >nul 2>nul

if exist ".git\index.lock" del /f /q ".git\index.lock"

git status
echo.

echo Preparando archivos de MAUex...
if exist frontend\index.html git add frontend\index.html
if exist frontend\styles.css git add frontend\styles.css
if exist frontend\firebase.js git add frontend\firebase.js
if exist frontend\app.js git add frontend\app.js
if exist frontend\helpers.js git add frontend\helpers.js
if exist frontend\nav.js git add frontend\nav.js
if exist frontend\themes.js git add frontend\themes.js
if exist frontend\signals.js git add frontend\signals.js
if exist frontend\calc.js git add frontend\calc.js
if exist frontend\dashboard.js git add frontend\dashboard.js
if exist frontend\watchlist.js git add frontend\watchlist.js
if exist frontend\positions.js git add frontend\positions.js
if exist frontend\history.js git add frontend\history.js
if exist frontend\analysis.js git add frontend\analysis.js
if exist frontend\exchange-keys.js git add frontend\exchange-keys.js
if exist frontend\orders.js git add frontend\orders.js
if exist frontend\init.js git add frontend\init.js
if exist vercel.json git add vercel.json
if exist .gitignore git add .gitignore
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
if exist ABRIR_MAUEX_LOCAL.bat git add ABRIR_MAUEX_LOCAL.bat
if exist ABRIR_MAUEX_LOCAL.ps1 git add ABRIR_MAUEX_LOCAL.ps1
if exist ACTIVAR_SEGURIDAD_FASE0_MAUEX.bat git add ACTIVAR_SEGURIDAD_FASE0_MAUEX.bat
if exist ACTIVAR_SEGURIDAD_FASE0_MAUEX.ps1 git add ACTIVAR_SEGURIDAD_FASE0_MAUEX.ps1
if exist PROBAR_SALUD_MAUEX.bat git add PROBAR_SALUD_MAUEX.bat
if exist PROBAR_SALUD_MAUEX.ps1 git add PROBAR_SALUD_MAUEX.ps1
if exist MAUEX_FASE2_DIAGNOSTICO_LOCAL.bat git add MAUEX_FASE2_DIAGNOSTICO_LOCAL.bat
if exist MAUEX_FASE2_DIAGNOSTICO_LOCAL.ps1 git add MAUEX_FASE2_DIAGNOSTICO_LOCAL.ps1
if exist MAUEX_FASE2_ROADMAP.md git add MAUEX_FASE2_ROADMAP.md
if exist MAUEX_FASE3_FRONTEND_PLAN.md git add MAUEX_FASE3_FRONTEND_PLAN.md
if exist MAUEX_FASE3_DIAGNOSTICO_FRONTEND.bat git add MAUEX_FASE3_DIAGNOSTICO_FRONTEND.bat
if exist MAUEX_FASE3_DIAGNOSTICO_FRONTEND.ps1 git add MAUEX_FASE3_DIAGNOSTICO_FRONTEND.ps1
if exist CONFIGURAR_HEARTBEAT_TELEGRAM_READER_ORACLE_MAUEX.bat git add CONFIGURAR_HEARTBEAT_TELEGRAM_READER_ORACLE_MAUEX.bat
if exist CONFIGURAR_HEARTBEAT_TELEGRAM_READER_ORACLE_MAUEX.ps1 git add CONFIGURAR_HEARTBEAT_TELEGRAM_READER_ORACLE_MAUEX.ps1
if exist frontend\package.json git add frontend\package.json
if exist frontend\vite.config.js git add frontend\vite.config.js
if exist frontend\proxy.js git add frontend\proxy.js
if exist frontend\helpers.js git add frontend\helpers.js
if exist frontend\nav.js git add frontend\nav.js
if exist frontend\themes.js git add frontend\themes.js
if exist frontend\signals.js git add frontend\signals.js
if exist frontend\calc.js git add frontend\calc.js
if exist frontend\dashboard.js git add frontend\dashboard.js
if exist frontend\watchlist.js git add frontend\watchlist.js
if exist frontend\positions.js git add frontend\positions.js
if exist frontend\history.js git add frontend\history.js
if exist frontend\analysis.js git add frontend\analysis.js
if exist frontend\exchange-keys.js git add frontend\exchange-keys.js
if exist frontend\orders.js git add frontend\orders.js
if exist frontend\init.js git add frontend\init.js
if exist frontend\src\README.md git add frontend\src\README.md
if exist MAUEX_API_KEYS.example.txt git add MAUEX_API_KEYS.example.txt
if exist GUIA_IBKR_FLEX_MAUEX.txt git add GUIA_IBKR_FLEX_MAUEX.txt
if exist REVISION_FABEL_MAUEX.md git add REVISION_FABEL_MAUEX.md
if exist SUBIR_MAUEX_A_GITHUB.bat git add SUBIR_MAUEX_A_GITHUB.bat
if exist scripts\deploy\SUBIR_BACKEND_MAUEX_A_GITHUB.bat git add scripts\deploy\SUBIR_BACKEND_MAUEX_A_GITHUB.bat
if exist MAUEX_ACTUALIZAR_TODO.bat git add MAUEX_ACTUALIZAR_TODO.bat
if exist MAUEX_ACTUALIZAR_TODO_AUTO.bat git add MAUEX_ACTUALIZAR_TODO_AUTO.bat
if exist scripts\deploy\COPIAR_WORKER_CLOUDFLARE.bat git add scripts\deploy\COPIAR_WORKER_CLOUDFLARE.bat
if exist scripts\setup\INSTALAR_IBKR_ORACLE_MAUEX.bat git add scripts\setup\INSTALAR_IBKR_ORACLE_MAUEX.bat
if exist scripts\setup\INSTALAR_IBKR_ORACLE_MAUEX.ps1 git add scripts\setup\INSTALAR_IBKR_ORACLE_MAUEX.ps1
if exist scripts\diagnostics\PROBAR_IBKR_MAUEX.bat git add scripts\diagnostics\PROBAR_IBKR_MAUEX.bat
if exist scripts\diagnostics\PROBAR_IBKR_MAUEX.ps1 git add scripts\diagnostics\PROBAR_IBKR_MAUEX.ps1
if exist oracle\telegram-reader git add oracle\telegram-reader
if exist scripts\deploy git add -A scripts\deploy
if exist scripts\setup git add -A scripts\setup
if exist scripts\diagnostics git add -A scripts\diagnostics
if exist .github git add -A .github

echo Registrando mudanzas y eliminaciones...
git add -u -- .
git add -A -- .gitignore package.json railway.toml vercel.json firebase.json firestore.rules wrangler.jsonc wrangler.mauex.restore.jsonc
git add -A -- README_MAUEX_ESTRUCTURA.txt OPERACION_MAUEX_FASE1.md MAUEX_FASE2_ROADMAP.md scripts\README.md

echo Guardando cambios locales...
git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo No hay cambios nuevos para guardar en commit.
) else (
  git commit -m "Organize MAUex scripts and phase 2 diagnostics"
  if errorlevel 1 (
    echo.
    echo No pude crear el commit local. Revisa el mensaje de Git de arriba.
    echo No sigo con el pull para no mezclar cambios.
    if not "%MAUEX_AUTO%"=="1" pause
    exit /b 1
  )
)

echo.
echo Trayendo la ultima version de GitHub...
set "STASHED=0"
git diff --quiet
if errorlevel 1 (
  echo Hay cambios locales sin guardar. Los guardo temporalmente para poder traer GitHub...
  git stash push -m "mauex-temp-before-pull"
  if not errorlevel 1 set "STASHED=1"
)

git pull --rebase origin main
if errorlevel 1 (
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
if errorlevel 1 (
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
