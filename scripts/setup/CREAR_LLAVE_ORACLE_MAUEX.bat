@echo off
setlocal

echo ============================================
echo   MAUex - crear llave SSH para Oracle
echo ============================================
echo.

set "SSH_DIR=%USERPROFILE%\.ssh"
set "KEY_FILE=%SSH_DIR%\mauex_oracle"

if not exist "%SSH_DIR%" mkdir "%SSH_DIR%"

if exist "%KEY_FILE%" (
  echo Ya existe una llave:
  echo %KEY_FILE%
  echo.
  echo No voy a pisarla.
) else (
  echo Creando llave SSH...
  ssh-keygen -t rsa -b 4096 -f "%KEY_FILE%" -N ""
)

echo.
echo Archivos creados:
echo %KEY_FILE%
echo %KEY_FILE%.pub
echo.
echo Copiando la PUBLIC KEY al portapapeles...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%KEY_FILE%.pub' -Raw | Set-Clipboard"

echo.
echo LISTO.
echo La public key ya esta copiada al portapapeles.
echo En Oracle tenes que pegarla donde diga Paste public key.
echo.
echo Se va a abrir la carpeta donde quedaron los archivos.
start "" "%SSH_DIR%"

echo.
pause
endlocal
