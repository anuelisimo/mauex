@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist ".wrangler\logs" mkdir ".wrangler\logs" >nul 2>nul
set "WRANGLER_LOG_PATH=%CD%\.wrangler\logs"
set "WRANGLER_WRITE_LOGS=false"
set "WRANGLER_SEND_METRICS=false"

echo.
echo ============================================
echo   MAUex - login Cloudflare Wrangler
echo ============================================
echo.
echo Se va a abrir el login de Cloudflare.
echo Despues de loguearte, volve a ejecutar:
echo   RESTAURAR_CLOUDFLARE_DESDE_BACKUP_MAUEX.bat
echo.

npx.cmd --cache ".\.npm-cache" wrangler login

echo.
npx.cmd --cache ".\.npm-cache" wrangler whoami
echo.
pause
