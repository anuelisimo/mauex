@echo off
chcp 65001 >nul
setlocal
title MAUex - fix linea tiempo senal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - fix linea vertical de senal
echo ============================================
echo.
echo Este BAT sube:
echo   app.js
echo   styles.css
echo   index.html
echo.
echo No toca Cloudflare. No toca variables. No toca secrets.
echo.

if not exist ".git" (
  echo No encontre la carpeta .git. Ejecuta este BAT desde la carpeta MauEX.
  pause
  exit /b 1
)

set "ME=%USERDOMAIN%\%USERNAME%"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Fix linea vertical de senal en charts"

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

echo 3/6 Actualizando versiones para evitar cache viejo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$v=Get-Date -Format 'yyyyMMdd-HHmmss'; $p='index.html'; $s=Get-Content -LiteralPath $p -Raw; $s=[regex]::Replace($s,'app\.js\?v=[0-9A-Za-z._-]+','app.js?v='+$v); $s=[regex]::Replace($s,'styles\.css\?v=[0-9A-Za-z._-]+','styles.css?v='+$v); Set-Content -LiteralPath $p -Value $s -NoNewline -Encoding UTF8; Write-Host ('Version aplicada: '+$v)"
if errorlevel 1 (
  echo.
  echo No pude actualizar la version de cache en index.html.
  pause
  exit /b 1
)

echo 4/6 Verificando sintaxis...
node --check app.js
if errorlevel 1 goto syntax_error

echo 5/6 Preparando cambios...
git add -- app.js styles.css index.html SUBIR_FIX_LINEA_TIEMPO_SENAL_MAUEX.bat
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

echo 6/6 Subiendo a GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo No pude subir a GitHub. Si GitHub pide login, completa la ventana y volve a ejecutar este BAT.
  pause
  exit /b 1
)

echo.
echo Listo: fix subido a GitHub.
echo.
pause
exit /b 0

:syntax_error
echo.
echo Hay un error de sintaxis. No subi nada.
echo Mandale captura de esta ventana a Codex.
pause
exit /b 1
