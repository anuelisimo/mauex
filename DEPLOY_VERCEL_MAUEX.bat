@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - deploy directo Vercel
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEPLOY_VERCEL_MAUEX.ps1"
if errorlevel 1 (
  echo.
  echo No pude deployar Vercel. Deja esta ventana abierta y mandale una captura a Codex.
  pause
  exit /b 1
)

echo.
echo Vercel deployado.
pause
