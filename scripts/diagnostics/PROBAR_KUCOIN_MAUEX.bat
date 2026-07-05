@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   MAUex - probar sincronizacion KuCoin
echo ============================================
echo.
echo Este archivo no modifica nada. Solo prueba Oracle y Cloudflare.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_KUCOIN_MAUEX.ps1"

endlocal
