@echo off
setlocal

echo.
echo ============================================
echo   MAUex - reiniciar lector Telegram
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0REINICIAR_TELEGRAM_READER_ORACLE_MAUEX.ps1"

echo.
pause
