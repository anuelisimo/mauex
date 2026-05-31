@echo off
setlocal

echo.
echo ============================================
echo   MAUex - lector automatico Telegram
echo ============================================
echo.
echo Esto instala en Oracle un lector con TU cuenta de Telegram.
echo Sirve para leer canales donde sos miembro, aunque no seas admin.
echo.
echo Necesitas:
echo   - API ID y API Hash de https://my.telegram.org
echo   - La clave TELEGRAM_WEBHOOK_SECRET que ya usas en Cloudflare
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_TELEGRAM_READER_ORACLE_MAUEX.ps1"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Se freno el proceso. Deja esta ventana abierta y mandale captura a Codex.
  pause
  exit /b 1
)

echo.
pause
