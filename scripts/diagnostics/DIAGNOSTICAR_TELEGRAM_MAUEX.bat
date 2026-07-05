@echo off
setlocal
title MAUex - diagnosticar Telegram

echo.
echo ============================================
echo   MAUex - diagnosticar llegada de senales
echo ============================================
echo.
echo Este archivo NO modifica nada.
echo Revisa Cloudflare, la bandeja de senales y el lector de Oracle.
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0DIAGNOSTICAR_TELEGRAM_MAUEX.ps1"

echo.
echo Presiona una tecla para cerrar...
pause >nul

