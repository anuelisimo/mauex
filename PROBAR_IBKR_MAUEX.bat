@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - probar IBKR / Oracle / Worker
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_IBKR_MAUEX.ps1"

echo.
if not "%MAUEX_AUTO%"=="1" pause
