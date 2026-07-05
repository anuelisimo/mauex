@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - probar salud completa
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_SALUD_MAUEX.ps1"
set "HEALTH_EXIT=%ERRORLEVEL%"

if "%HEALTH_EXIT%"=="2" (
  echo.
  echo Cloudflare respondio 429. Espera unos minutos y volve a ejecutar este BAT.
  echo Esto no confirma una falla de MAUex; significa que Cloudflare bloqueo la prueba antes del Worker.
)

echo.
if not "%MAUEX_AUTO%"=="1" pause
exit /b %HEALTH_EXIT%
