@echo off
setlocal
cd /d "C:\Users\mauap\Downloads\MauEX"

echo.
echo ============================================
echo   MAUex - instalar AI visual en Oracle
echo ============================================
echo.
echo Este archivo:
echo   1. Actualiza el backend Oracle de MAUex
echo   2. Instala Ollama si falta
echo   3. Descarga un modelo visual local
echo   4. Activa el endpoint /signal-vision-ai
echo.
echo No pisa tus claves de Binance, KuCoin ni IBKR.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_AI_VISUAL_ORACLE_MAUEX.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Se freno la instalacion. Deja esta ventana abierta y mandale captura a Codex.
  echo.
  pause
  exit /b 1
)

echo.
echo Listo. AI visual local quedo preparada en Oracle.
echo.
pause
