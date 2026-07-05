@echo off
setlocal

echo.
echo ============================================
echo   MAUex - apagar backfill Telegram
echo ============================================
echo.
echo Esto evita que Oracle reenvie senales viejas y consuma cuota KV.
echo A partir de ahora solo entraran senales nuevas.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DESACTIVAR_BACKFILL_TELEGRAM_READER_MAUEX.ps1"

echo.
pause
