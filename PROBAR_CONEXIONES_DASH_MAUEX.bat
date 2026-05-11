@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - probar conexiones del dashboard
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_CONEXIONES_DASH_MAUEX.ps1"

echo.
pause
