@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0PROBAR_AI_VISUAL_MAUEX.ps1"
pause
