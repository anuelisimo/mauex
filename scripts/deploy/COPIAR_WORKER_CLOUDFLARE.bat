@echo off
setlocal

set "WORKER_FILE=C:\Users\mauap\Downloads\MauEX\worker\worker.js"

echo.
echo ============================================
echo   MAUex - copiar Worker para Cloudflare
echo ============================================
echo.

if not exist "%WORKER_FILE%" (
  echo No encontre:
  echo %WORKER_FILE%
  echo.
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%WORKER_FILE%' -Raw | Set-Clipboard"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude copiar el Worker al portapapeles.
  echo Mandale captura de esta ventana a Codex.
  if not "%MAUEX_AUTO%"=="1" pause
  exit /b 1
)

echo Listo. El codigo completo del Worker ya esta copiado.
echo.
echo Ahora anda a Cloudflare:
echo Workers ^& Pages ^> mauex-proxy ^> Edit code
echo Borra todo, pega con Ctrl+V, y toca Deploy.
echo.
if not "%MAUEX_AUTO%"=="1" pause
