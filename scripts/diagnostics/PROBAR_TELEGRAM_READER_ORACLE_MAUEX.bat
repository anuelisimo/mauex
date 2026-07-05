@echo off
setlocal

echo.
echo ============================================
echo   MAUex - probar lector Telegram
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_TELEGRAM_READER_ORACLE_MAUEX.ps1"

echo.
pause
