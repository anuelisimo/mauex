@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   MAUex - agregar KuCoin a Oracle
echo ============================================
echo.
echo Este instalador mantiene Binance como esta y agrega KuCoin
echo al mismo servidor de Oracle.
echo.
echo Necesitas tener a mano:
echo - La private key de Oracle
echo - KUCOIN_KEY
echo - KUCOIN_SECRET
echo - KUCOIN_PASSPHRASE
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_KUCOIN_ORACLE_MAUEX.ps1"

endlocal
