@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   MAUex - actualizar backend Oracle
echo ============================================
echo.
echo Este archivo sube el backend corregido a Oracle.
echo No pisa tus claves de Binance, KuCoin ni IBKR.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ACTUALIZAR_ORACLE_MAUEX.ps1"

endlocal
