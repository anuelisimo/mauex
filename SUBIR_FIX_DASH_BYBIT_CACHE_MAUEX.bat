@echo off
chcp 65001 >nul
setlocal
title MAUex - fix dashboard Bybit cache
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - fix dashboard Bybit cache
echo ============================================
echo.
echo Este BAT sube:
echo   app.js
echo   index.html
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
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Fix dashboard Bybit live capital cache"

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
  echo Git sigue bloqueado. Ejecuta este BAT como administrador.
  pause
  exit /b 1
)

echo 3/7 Actualizando version para evitar cache viejo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$v=Get-Date -Format 'yyyyMMdd-HHmmss'; $p='index.html'; $s=Get-Content -LiteralPath $p -Raw; $s=[regex]::Replace($s,'app\.js\?v=[0-9A-Za-z._-]+','app.js?v='+$v); Set-Content -LiteralPath $p -Value $s -NoNewline -Encoding UTF8; Write-Host ('Version app.js aplicada: '+$v)"
if errorlevel 1 (
  echo.
  echo No pude actualizar la version de cache en index.html.
  pause
  exit /b 1
)

echo 4/7 Verificando sintaxis...
node --check app.js
if errorlevel 1 goto syntax_error
node --check worker.js
if errorlevel 1 goto syntax_error

echo 5/7 Preparando cambios...
git add -- app.js index.html worker.js SUBIR_FIX_DASH_BYBIT_CACHE_MAUEX.bat
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
  echo 6/7 Creando commit...
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo.
    echo No pude crear el commit. Revisa el mensaje de Git de arriba.
    pause
    exit /b 1
  )
)

echo Subiendo a GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo No pude subir a GitHub. Si GitHub pide login, completa la ventana y volve a ejecutar este BAT.
  pause
  exit /b 1
)

echo 7/7 Copiando worker.js al portapapeles...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath 'worker.js' -Raw | Set-Clipboard"
if errorlevel 1 (
  echo.
  echo Cambios subidos, pero no pude copiar worker.js.
  echo Abri worker.js, copialo completo y pegalo en Cloudflare manualmente.
  pause
  exit /b 1
)

echo.
echo Listo: cambios subidos a GitHub.
echo Worker actualizado copiado al portapapeles.
echo.
echo Aplica Worker manualmente solo si todavia no desplegaste esta version:
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
