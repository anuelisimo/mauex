@echo off
setlocal

echo.
echo ============================================
echo   MAUex - probar Worker Telegram
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_WORKER_TELEGRAM_MAUEX.ps1"

echo.
pause
