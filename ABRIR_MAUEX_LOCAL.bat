@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - abrir app local
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ABRIR_MAUEX_LOCAL.ps1"

endlocal
