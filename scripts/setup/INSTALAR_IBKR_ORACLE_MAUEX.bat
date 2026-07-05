@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - agregar IBKR a Oracle
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_IBKR_ORACLE_MAUEX.ps1"

echo.
if not "%MAUEX_AUTO%"=="1" pause
