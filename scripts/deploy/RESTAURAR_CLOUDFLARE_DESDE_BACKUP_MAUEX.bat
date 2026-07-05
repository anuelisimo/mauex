@echo off
chcp 65001 >nul
setlocal
title MAUex - restaurar Cloudflare desde backup
cd /d "%~dp0"
if not exist ".wrangler\logs" mkdir ".wrangler\logs" >nul 2>nul
set "WRANGLER_LOG_PATH=%CD%\.wrangler\logs"
set "WRANGLER_WRITE_LOGS=false"
set "WRANGLER_SEND_METRICS=false"

echo.
echo ============================================
echo   MAUex - restaurar Cloudflare desde backup
echo ============================================
echo.
echo Este BAT lee BACKUP_VARIABLES_CLOUDFLARE_MAUEX.txt.
echo No imprime secretos.
echo.

node RESTAURAR_CLOUDFLARE_DESDE_BACKUP_MAUEX.mjs
if errorlevel 1 (
  echo.
  echo No se pudo restaurar automaticamente.
  echo Revisa el mensaje de arriba.
  echo.
  pause
  exit /b 1
)

echo.
echo Restauracion terminada. Corro diagnostico seguro...
call "%~dp0DIAGNOSTICAR_WORKER_VARIABLES_MAUEX.bat"
