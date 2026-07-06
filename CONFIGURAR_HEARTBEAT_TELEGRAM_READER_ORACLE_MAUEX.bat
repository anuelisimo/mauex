@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   MAUex - heartbeat Telegram reader Oracle
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CONFIGURAR_HEARTBEAT_TELEGRAM_READER_ORACLE_MAUEX.ps1"
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
  echo Listo. Heartbeat del Telegram reader configurado.
) else (
  echo Hubo un problema configurando el heartbeat. Deja esta ventana abierta y mandale una captura a Codex.
)
echo.
pause
exit /b %ERR%
