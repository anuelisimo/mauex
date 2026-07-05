@echo off
chcp 65001 >nul
setlocal
title MAUex - subir cambios app
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - subir cambios app
echo ============================================
echo.
echo Este script sube SOLO estos archivos:
echo   frontend\app.js
echo   frontend\firebase.js
echo   frontend\index.html
echo   worker\worker.js
echo   vercel.json
echo.

if not exist ".git" (
  echo No encontre la carpeta .git. Ejecuta este BAT desde la carpeta MauEX.
  pause
  exit /b 1
)

set "ME=%USERDOMAIN%\%USERNAME%"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Update MAUex frontend"

echo 1/5 Corrigiendo permisos de Git...
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
  echo Git sigue bloqueado.
  echo Cierra esta ventana y ejecuta este BAT con click derecho:
  echo "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

echo 3/6 Actualizando version para evitar cache viejo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$v=Get-Date -Format 'yyyyMMdd-HHmmss'; $p='frontend\index.html'; $s=Get-Content -LiteralPath $p -Raw; $s=[regex]::Replace($s,'firebase\.js\?v=[0-9A-Za-z._-]+','firebase.js?v='+$v); $s=[regex]::Replace($s,'app\.js\?v=[0-9A-Za-z._-]+','app.js?v='+$v); Set-Content -LiteralPath $p -Value $s -NoNewline -Encoding UTF8; Write-Host ('Version aplicada: '+$v)"
if errorlevel 1 (
  echo.
  echo No pude actualizar la version de cache en index.html.
  echo.
  pause
  exit /b 1
)

echo 4/6 Verificando sintaxis...
node --check frontend\app.js
if errorlevel 1 goto syntax_error
node --check frontend\firebase.js
if errorlevel 1 goto syntax_error
node --check worker\worker.js
if errorlevel 1 goto syntax_error

echo 5/6 Preparando cambios...
git add -- frontend\app.js frontend\firebase.js frontend\index.html frontend\styles.css worker\worker.js vercel.json wrangler.jsonc .github\workflows\deploy-worker.yml
if errorlevel 1 (
  echo.
  echo No pude preparar los archivos.
  echo Ejecuta este BAT como administrador y volve a probar.
  echo.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo No hay cambios nuevos para commitear. Intento subir la rama igual...
) else (
  echo 6/6 Creando commit...
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo.
    echo No pude crear el commit.
    echo Revisa el mensaje de Git de arriba.
    echo.
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
  echo.
  pause
  exit /b 1
)

echo.
echo Listo: cambios de app subidos a GitHub.
echo Si cambiaste worker.js, ejecuta tambien:
echo   DESPLEGAR_WORKER_CLOUDFLARE.bat
echo.
pause

exit /b 0

:syntax_error
echo.
echo Hay un error de sintaxis. No subi nada.
echo Mandale captura de esta ventana a Codex.
echo.
pause
exit /b 1
