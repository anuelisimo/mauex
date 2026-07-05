@echo off
chcp 65001 >nul
setlocal
title MAUex - verificar login Cloudflare
cd /d "%~dp0"
if not exist ".wrangler\logs" mkdir ".wrangler\logs" >nul 2>nul
set "WRANGLER_LOG_PATH=%CD%\.wrangler\logs"
set "WRANGLER_WRITE_LOGS=false"
set "WRANGLER_SEND_METRICS=false"

echo.
echo ============================================
echo   MAUex - verificar login Cloudflare
echo ============================================
echo.
echo Este BAT solo verifica si Wrangler esta autenticado.
echo No despliega worker. No modifica variables. No modifica secrets.
echo.

node RESTAURAR_CLOUDFLARE_DESDE_BACKUP_MAUEX.mjs --check-auth
if errorlevel 1 (
  echo.
  echo Wrangler no esta autenticado para este restaurador.
  echo Ejecuta LOGIN_CLOUDFLARE_WRANGLER_MAUEX.bat y volve a probar.
  echo.
  pause
  exit /b 1
)

echo.
echo OK: Wrangler esta autenticado para el restaurador.
echo.
pause
