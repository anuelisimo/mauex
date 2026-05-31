@echo off
setlocal

echo.
echo ============================================
echo   MAUex - configurar Telegram Signals
echo ============================================
echo.
echo Antes de correr esto:
echo   1. Crea un bot con BotFather y copia el token.
echo   2. En Cloudflare Worker agrega estas variables:
echo      TELEGRAM_BOT_TOKEN
echo      TELEGRAM_WEBHOOK_SECRET
echo      TELEGRAM_INBOX_SECRET
echo      Pueden tener el mismo valor.
echo      GEMINI_API_KEY  ^(recomendado, para interpretar texto + imagen con AI gratis^)
echo      AI_SIGNAL_PROVIDER=gemini
echo      GEMINI_SIGNAL_MODEL  ^(opcional: gemini-2.5-flash^)
echo      OPENAI_API_KEY  ^(opcional, respaldo si algun dia queres usar OpenAI^)
echo   3. Pega y despliega el worker.js actualizado.
echo.

set /p BOT_TOKEN=Pegue el token del bot de Telegram y presione Enter: 
if "%BOT_TOKEN%"=="" (
  echo Falta el token.
  pause
  exit /b 1
)

set /p WORKER_URL=URL del Worker [Enter = https://mauex-proxy.mauaparo.workers.dev]: 
if "%WORKER_URL%"=="" set "WORKER_URL=https://mauex-proxy.mauaparo.workers.dev"

set /p SECRET=Clave TELEGRAM_WEBHOOK_SECRET / TELEGRAM_INBOX_SECRET: 
if "%SECRET%"=="" (
  echo Falta la clave secreta.
  pause
  exit /b 1
)

echo.
echo Configurando webhook de Telegram...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$token='%BOT_TOKEN%'; $url='%WORKER_URL%/telegram-webhook'; $secret='%SECRET%'; $body=@{url=$url; secret_token=$secret; allowed_updates=@('message','channel_post','edited_message','edited_channel_post')} | ConvertTo-Json; Invoke-RestMethod -Method Post -Uri ('https://api.telegram.org/bot'+$token+'/setWebhook') -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo No pude configurar Telegram. Revisa token, Worker URL y que el Worker este deployado.
  pause
  exit /b 1
)

echo.
echo Revisando webhook...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$token='%BOT_TOKEN%'; Invoke-RestMethod -Uri ('https://api.telegram.org/bot'+$token+'/getWebhookInfo') | ConvertTo-Json -Depth 5"

echo.
echo Listo.
echo Si queres que MAUex interprete imagenes con AI, revisa que en Cloudflare tambien este GEMINI_API_KEY.
echo Ahora reenviate una senal de Bitcoin Bullets o Binance Killers al bot.
echo Luego entra a MAUex ^> Signals ^> Sincronizar Telegram.
echo.
pause
