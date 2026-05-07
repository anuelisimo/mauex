@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - subir cambios a GitHub
echo ============================================
echo.

git status
echo.

echo Preparando archivos del frontend...
git add index.html
if exist styles.css git add styles.css
if exist firebase.js git add firebase.js
if exist app.js git add app.js
if exist README_MAUEX_ESTRUCTURA.txt git add README_MAUEX_ESTRUCTURA.txt
if exist SUBIR_MAUEX_A_GITHUB.bat git add SUBIR_MAUEX_A_GITHUB.bat

echo Guardando cambios locales...
git commit -m "Separate MAUex frontend files"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Puede que no haya cambios nuevos para guardar. Sigo igual.
)

echo.
echo Trayendo la ultima version de GitHub...
git pull --rebase origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude acomodar automaticamente los cambios con la version online.
  echo Deja esta ventana abierta y mandale una captura a Codex.
  echo.
  pause
  exit /b 1
)

echo.
echo Revisando si todavia hay cambios pendientes...
git status --short
echo.

git push origin main
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude subir a GitHub. Puede faltar login de GitHub en esta PC.
  echo Si te aparece una ventana de GitHub, inicia sesion y volve a ejecutar este archivo.
  pause
  exit /b 1
)

echo.
echo Listo. Cambios subidos a GitHub.
echo Vercel deberia actualizar la web automaticamente en unos minutos.
echo.
pause
