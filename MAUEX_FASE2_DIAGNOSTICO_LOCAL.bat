@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - diagnostico local Fase 2
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0MAUEX_FASE2_DIAGNOSTICO_LOCAL.ps1"
set "DIAG_EXIT=%ERRORLEVEL%"

echo.
if not "%MAUEX_AUTO%"=="1" pause
exit /b %DIAG_EXIT%
