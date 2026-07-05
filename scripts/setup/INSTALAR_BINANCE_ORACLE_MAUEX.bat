@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   MAUex - instalar Binance en Oracle
echo ============================================
echo.
echo Este instalador va a subir el backend a Oracle.
echo Necesitas tener a mano:
echo - La private key descargada de Oracle
echo - BINANCE_KEY
echo - BINANCE_SECRET
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_BINANCE_ORACLE_MAUEX.ps1"

endlocal
