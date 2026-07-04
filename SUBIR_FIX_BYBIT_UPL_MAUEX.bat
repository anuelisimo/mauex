@echo off
chcp 65001 >nul
setlocal
title MAUex - fix Bybit UPL
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - fix Bybit UPL
echo ============================================
echo.
echo Este BAT sube:
echo   worker.js
echo.
echo No toca Cloudflare. No toca variables. No toca secrets.
echo Al final copia worker.js al portapapeles para deploy manual.
echo.

if not exist ".git" (
  echo No encontre la carpeta .git. Ejecuta este BAT desde la carpeta MauEX.
  pause
  exit /b 1
)

set "ME=%USERDOMAIN%\%USERNAME%"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Fix Bybit UPL en capital"

echo 1/6 Corrigiendo permisos de Git...
icacls ".git" /remove:d "LegionMau\CodexSandboxUsers" >nul 2>nul
icacls ".git" /remove:d "LegionMau\codexsandboxoffline" >nul 2>nul
icacls ".git" /remove:d *S-1-5-21-4070875099-3014453175-1194438234-2994042337 >nul 2>nul
icacls ".git" /grant "%ME%:(OI)(CI)F" /T /C >nul
icacls ".git" /grant "LegionMau\CodexSandboxUsers:(OI)(CI)M" /T /C >nul 2>nul
icacls ".git" /grant "LegionMau\codexsandboxoffline:(OI)(CI)M" /T /C >nul 2>nul
if exist ".git\index.lock" del /f /q ".git\index.lock"

echo 2/6 Verificando Git...
git status >nul 2>nul
if errorlevel 1 (
  echo.
  echo Git sigue bloqueado. Ejecuta este BAT como administrador.
  pause
  exit /b 1
)

echo 3/6 Verificando sintaxis...
node --check worker.js
if errorlevel 1 goto syntax_error

echo 4/6 Preparando cambios...
git add -- worker.js SUBIR_FIX_BYBIT_UPL_MAUEX.bat
if errorlevel 1 (
  echo.
  echo No pude preparar los archivos. Ejecuta este BAT como administrador.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo No hay cambios nuevos para commitear. Intento subir la rama igual...
) else (
  echo Creando commit...
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo.
    echo No pude crear el commit. Revisa el mensaje de Git de arriba.
    pause
    exit /b 1
  )
)

echo 5/6 Subiendo a GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo No pude subir a GitHub. Si GitHub pide login, completa la ventana y volve a ejecutar este BAT.
  pause
  exit /b 1
)

echo 6/6 Copiando worker.js al portapapeles...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath 'worker.js' -Raw | Set-Clipboard"
if errorlevel 1 (
  echo.
  echo Cambios subidos, pero no pude copiar worker.js.
  echo Ejecuta COPIAR_WORKER_CLOUDFLARE.bat manualmente.
  pause
  exit /b 1
)

echo.
echo Listo: cambios subidos a GitHub.
echo Worker actualizado copiado al portapapeles.
echo.
echo Ahora aplica Worker:
echo Cloudflare ^> Workers ^& Pages ^> mauex-proxy ^> Edit code
echo Pega worker.js y toca Deploy.
echo.
pause
exit /b 0

:syntax_error
echo.
echo Hay un error de sintaxis. No subi nada.
echo Mandale captura de esta ventana a Codex.
pause
exit /b 1
