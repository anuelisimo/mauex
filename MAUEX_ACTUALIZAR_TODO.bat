@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

:MENU
cls
echo.
echo ============================================
echo   MAUex - panel principal
echo ============================================
echo.
echo 1 - Subir MAUex a GitHub / Vercel
echo 2 - Probar salud completa
echo 3 - Abrir MAUex local
echo 4 - Diagnostico local Fase 2
echo 5 - Backend / Worker: subir a GitHub
echo 6 - Worker: copiar para Cloudflare
echo 7 - Oracle: instalar IBKR
echo 8 - Diagnosticos especificos
echo 9 - Actualizacion completa automatica
echo 0 - Salir
echo.
set /p op=Elegi una opcion y presiona Enter: 

if "%op%"=="1" call "%~dp0SUBIR_MAUEX_A_GITHUB.bat"
if "%op%"=="2" call "%~dp0PROBAR_SALUD_MAUEX.bat"
if "%op%"=="3" call "%~dp0ABRIR_MAUEX_LOCAL.bat"
if "%op%"=="4" call "%~dp0MAUEX_FASE2_DIAGNOSTICO_LOCAL.bat"
if "%op%"=="5" call "%~dp0scripts\deploy\SUBIR_BACKEND_MAUEX_A_GITHUB.bat"
if "%op%"=="6" call "%~dp0scripts\deploy\COPIAR_WORKER_CLOUDFLARE.bat"
if "%op%"=="7" call "%~dp0scripts\setup\INSTALAR_IBKR_ORACLE_MAUEX.bat"
if "%op%"=="8" call "%~dp0scripts\diagnostics\PROBAR_IBKR_MAUEX.bat"
if "%op%"=="9" call "%~dp0MAUEX_ACTUALIZAR_TODO_AUTO.bat"
if "%op%"=="0" exit /b 0

goto MENU
