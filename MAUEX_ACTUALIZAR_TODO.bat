@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

:MENU
cls
echo.
echo ============================================
echo   MAUex - panel de actualizacion
echo ============================================
echo.
echo 1 - Subir frontend a GitHub / Vercel
echo 2 - Subir backend/Worker a GitHub
echo 3 - Instalar soporte IBKR en Oracle
echo 4 - Copiar Worker para pegar en Cloudflare
echo 5 - Probar IBKR / Oracle / Cloudflare
echo 6 - Actualizacion completa automatica
echo 0 - Salir
echo.
set /p op=Elegi una opcion y presiona Enter: 

if "%op%"=="1" call "%~dp0SUBIR_MAUEX_A_GITHUB.bat"
if "%op%"=="2" call "%~dp0SUBIR_BACKEND_MAUEX_A_GITHUB.bat"
if "%op%"=="3" call "%~dp0INSTALAR_IBKR_ORACLE_MAUEX.bat"
if "%op%"=="4" call "%~dp0COPIAR_WORKER_CLOUDFLARE.bat"
if "%op%"=="5" call "%~dp0PROBAR_IBKR_MAUEX.bat"
if "%op%"=="6" call "%~dp0MAUEX_ACTUALIZAR_TODO_AUTO.bat"
if "%op%"=="0" exit /b 0

goto MENU
