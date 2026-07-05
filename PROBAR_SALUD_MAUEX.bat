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

echo.
if not "%MAUEX_AUTO%"=="1" pause
