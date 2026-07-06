@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - deploy directo Worker Cloudflare
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEPLOY_WORKER_MAUEX.ps1"
if errorlevel 1 (
  echo.
  echo No pude deployar el Worker. Deja esta ventana abierta y mandale una captura a Codex.
  pause
  exit /b 1
)

echo.
echo Worker deployado y probado.
pause
