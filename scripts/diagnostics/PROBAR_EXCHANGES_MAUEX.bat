@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PROBAR_EXCHANGES_MAUEX.ps1"

