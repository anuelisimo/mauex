@echo off
chcp 65001 >nul
setlocal
title MAUex - fix sync precios y capital
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - fix sync precios y capital
echo ============================================
echo.
echo Este BAT sube los cambios de:
echo   - precios live de tickers
echo   - Capital y exposicion
echo   - Worker de Cloudflare
echo.

if not exist ".git" (
  echo No encontre la carpeta .git. Ejecuta este BAT desde la carpeta MauEX.
  pause
  exit /b 1
)

set "ME=%USERDOMAIN%\%USERNAME%"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Fix sync precios y capital MAUex"

echo 1/7 Corrigiendo permisos de Git...
icacls ".git" /remove:d "LegionMau\CodexSandboxUsers" >nul 2>nul
icacls ".git" /remove:d "LegionMau\codexsandboxoffline" >nul 2>nul
icacls ".git" /remove:d *S-1-5-21-4070875099-3014453175-1194438234-2994042337 >nul 2>nul
icacls ".git" /grant "%ME%:(OI)(CI)F" /T /C >nul
icacls ".git" /grant "LegionMau\CodexSandboxUsers:(OI)(CI)M" /T /C >nul 2>nul
icacls ".git" /grant "LegionMau\codexsandboxoffline:(OI)(CI)M" /T /C >nul 2>nul

if exist ".git\index.lock" del /f /q ".git\index.lock"

echo 2/7 Verificando Git...
git status >nul 2>nul
if errorlevel 1 (
  echo.
  echo Git sigue bloqueado.
  echo Ejecuta este BAT con click derecho:
  echo "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

echo 3/7 Actualizando version para evitar cache viejo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$v=Get-Date -Format 'yyyyMMdd-HHmmss'; $p='index.html'; $s=Get-Content -LiteralPath $p -Raw; $s=[regex]::Replace($s,'firebase\.js\?v=[0-9A-Za-z._-]+','firebase.js?v='+$v); $s=[regex]::Replace($s,'app\.js\?v=[0-9A-Za-z._-]+','app.js?v='+$v); Set-Content -LiteralPath $p -Value $s -NoNewline -Encoding UTF8; Write-Host ('Version aplicada: '+$v)"
if errorlevel 1 (
  echo.
  echo No pude actualizar la version de cache en index.html.
  pause
  exit /b 1
)

echo 4/7 Verificando sintaxis...
node --check app.js
if errorlevel 1 goto syntax_error
node --check firebase.js
if errorlevel 1 goto syntax_error
node --check worker.js
if errorlevel 1 goto syntax_error

echo 5/7 Preparando cambios...
git add -- app.js firebase.js index.html worker.js COPIAR_WORKER_CLOUDFLARE.bat SUBIR_FIX_SYNC_PRECIOS_CAPITAL_MAUEX.bat DIAGNOSTICAR_SYNC_PRECIOS_CAPITAL_MAUEX.bat
if errorlevel 1 (
  echo.
  echo No pude preparar los archivos.
  echo Ejecuta este BAT como administrador y volve a probar.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo No hay cambios nuevos para commitear. Intento subir la rama igual...
) else (
  echo 6/7 Creando commit...
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo.
    echo No pude crear el commit.
    echo Revisa el mensaje de Git de arriba.
    pause
    exit /b 1
  )
)

echo Subiendo a GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo No pude subir a GitHub.
  echo Si GitHub pide login, completa la ventana de autenticacion y volve a ejecutar este BAT.
  pause
  exit /b 1
)

echo 7/7 Copiando worker.js al portapapeles para Cloudflare...
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
echo.
echo IMPORTANTE:
echo El Worker actualizado ya esta copiado al portapapeles.
echo Ahora anda a Cloudflare:
echo Workers ^& Pages ^> mauex-proxy ^> Edit code
echo Borra todo, pega con Ctrl+V, y toca Deploy.
echo.
pause
exit /b 0

:syntax_error
echo.
echo Hay un error de sintaxis. No subi nada.
echo Mandale captura de esta ventana a Codex.
pause
exit /b 1
