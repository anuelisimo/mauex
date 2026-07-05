@echo off
setlocal

echo ============================================
echo   MAUex - crear NUEVA llave SSH para Oracle
echo ============================================
echo.
echo Esta crea una llave nueva porque la anterior no debe reutilizarse.
echo.

set "SSH_DIR=%USERPROFILE%\.ssh"
set "KEY_FILE=%SSH_DIR%\mauex_oracle_nueva"

if not exist "%SSH_DIR%" mkdir "%SSH_DIR%"

if exist "%KEY_FILE%" (
  echo Ya existe:
  echo %KEY_FILE%
  echo.
  echo Voy a crear una con fecha/hora para no pisarla.
  set "KEY_FILE=%SSH_DIR%\mauex_oracle_nueva_%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
  set "KEY_FILE=%KEY_FILE: =0%"
)

ssh-keygen -t rsa -b 4096 -f "%KEY_FILE%" -N ""

echo.
echo Archivos creados:
echo %KEY_FILE%
echo %KEY_FILE%.pub
echo.
echo Copiando la PUBLIC KEY nueva al portapapeles...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%KEY_FILE%.pub' -Raw | Set-Clipboard"

echo.
echo LISTO.
echo La public key nueva ya esta copiada al portapapeles.
echo En Oracle, al recrear la instancia, elegi Paste public key y pegala.
echo.
echo IMPORTANTE:
echo Cuando el instalador pida la private key, tenes que pegar la RUTA:
echo %KEY_FILE%
echo.
start "" "%SSH_DIR%"

pause
endlocal
