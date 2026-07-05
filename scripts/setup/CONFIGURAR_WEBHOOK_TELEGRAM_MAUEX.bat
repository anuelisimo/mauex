@echo off
chcp 65001 >nul
setlocal
title MAUex - configurar webhook Telegram
cd /d "%~dp0"

echo.
echo ============================================
echo   MAUex - configurar webhook Telegram
echo ============================================
echo.
echo Este BAT conecta tu bot de Telegram con el Worker de MAUex.
echo No toca Cloudflare. No sube nada a Git. No imprime secretos.
echo.

set "WORKER_URL=https://mauex-proxy.mauaparo.workers.dev"

for /f "usebackq tokens=1,* delims==" %%A in ("MAUEX_API_KEYS.txt") do (
  if /I "%%A"=="TELEGRAM_WEBHOOK_SECRET" set "SECRET=%%B"
  if /I "%%A"=="TELEGRAM_BOT_TOKEN" set "BOT_TOKEN=%%B"
)

if "%SECRET%"=="" (
  for /f "usebackq tokens=1,* delims==" %%A in ("MAUEX_API_KEYS.txt") do (
    if /I "%%A"=="TELEGRAM_INBOX_SECRET" set "SECRET=%%B"
  )
)

if "%SECRET%"=="" (
  echo No encontre TELEGRAM_WEBHOOK_SECRET en MAUEX_API_KEYS.txt.
  echo Ejecuta primero GENERAR_TELEGRAM_INBOX_SECRET_MAUEX.bat.
  echo.
  pause
  exit /b 1
)

if "%BOT_TOKEN%"=="" (
  echo Pega el token del bot de Telegram.
  echo Lo podes conseguir en Telegram: @BotFather ^> /mybots ^> tu bot ^> API Token.
  echo.
  set /p BOT_TOKEN=Bot token: 
)

if "%BOT_TOKEN%"=="" (
  echo Falta el token del bot.
  pause
  exit /b 1
)

echo.
echo Configurando webhook...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$token=$env:BOT_TOKEN;" ^
  "$secret=$env:SECRET;" ^
  "$url=$env:WORKER_URL.TrimEnd('/') + '/telegram-webhook';" ^
  "$body=@{url=$url; secret_token=$secret; allowed_updates=@('message','channel_post','edited_message','edited_channel_post')} | ConvertTo-Json;" ^
  "$res=Invoke-RestMethod -Method Post -Uri ('https://api.telegram.org/bot'+$token+'/setWebhook') -ContentType 'application/json' -Body $body;" ^
  "if(-not $res.ok){ throw ($res | ConvertTo-Json -Depth 5) }" ^
  "Write-Host 'OK: webhook configurado.'"

if errorlevel 1 (
  echo.
  echo No pude configurar el webhook.
  echo Revisa que el token del bot sea correcto.
  echo.
  pause
  exit /b 1
)

echo.
echo Revisando webhook...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$token=$env:BOT_TOKEN;" ^
  "$info=Invoke-RestMethod -Uri ('https://api.telegram.org/bot'+$token+'/getWebhookInfo');" ^
  "[pscustomobject]@{ ok=$true; url=$info.result.url; pending_update_count=$info.result.pending_update_count; last_error_date=$info.result.last_error_date; last_error_message=$info.result.last_error_message } | ConvertTo-Json -Depth 5"

echo.
echo Listo.
echo Ahora envia un mensaje NUEVO al bot y despues en MAUex toca Sincronizar Telegram.
echo.
echo Si mandas imagenes o capturas al bot, tambien agrega TELEGRAM_BOT_TOKEN como Secret en Cloudflare.
echo Para mensajes de texto, el webhook alcanza.
echo.
pause
