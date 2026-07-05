@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - configurar IBKR Flex Web
echo ============================================
echo.
echo Este archivo conecta IBKR al Dashboard usando Flex Web Service.
echo No guarda usuario ni password de IBKR. Solo guarda token y Query ID.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_IBKR_FLEX_ORACLE_MAUEX.ps1"
if %ERRORLEVEL% NEQ 0 goto FAIL
exit /b 0

:FAIL
echo.
echo Se freno el proceso. Deja esta ventana abierta y mandale captura a Codex.
echo.
pause
exit /b 1
