@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - activar seguridad Fase 0
echo ============================================
echo.
echo Este asistente configura el token interno, actualiza Worker,
echo frontend, backend/Oracle y prepara Firestore Rules.
echo.
echo No imprime el token en pantalla y no lo sube a Git.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ACTIVAR_SEGURIDAD_FASE0_MAUEX.ps1"

echo.
if not "%MAUEX_AUTO%"=="1" pause
