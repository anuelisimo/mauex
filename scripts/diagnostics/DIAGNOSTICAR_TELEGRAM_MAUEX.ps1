$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "============================================"
Write-Host "  MAUex - diagnosticar llegada de senales"
Write-Host "============================================"
Write-Host ""
Write-Host "Este archivo NO modifica nada."
Write-Host "Sirve para distinguir:"
Write-Host "  1. Si Cloudflare/Worker esta bien"
Write-Host "  2. Si la bandeja de Telegram tiene senales"
Write-Host "  3. Si el lector automatico de Oracle esta vivo"
Write-Host ""

$workerUrl = Read-Host "URL del Worker [Enter = https://mauex-proxy.mauaparo.workers.dev]"
if ([string]::IsNullOrWhiteSpace($workerUrl)) { $workerUrl = "https://mauex-proxy.mauaparo.workers.dev" }
$workerUrl = $workerUrl.TrimEnd("/")

$secret = Read-Host "Pega TELEGRAM_WEBHOOK_SECRET / TELEGRAM_INBOX_SECRET"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
$keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
$keyPath = $keyPath.Trim().Trim('"')

function Show-Request($title, $scriptBlock) {
  Write-Host ""
  Write-Host "---- $title ----"
  try {
    & $scriptBlock
  } catch {
    Write-Host "ERROR:" $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Write-Host "BODY:" $_.ErrorDetails.Message
    }
  }
}

Show-Request "Cloudflare health" {
  $r = Invoke-RestMethod "$workerUrl/health?t=$(Get-Date -UFormat %s)" -TimeoutSec 30
  $r | ConvertTo-Json -Depth 20
}

if (![string]::IsNullOrWhiteSpace($secret)) {
  Show-Request "Inbox Telegram en Cloudflare" {
    $encoded = [uri]::EscapeDataString($secret)
    $r = Invoke-RestMethod "$workerUrl/telegram-signals?secret=$encoded&t=$(Get-Date -UFormat %s)" -TimeoutSec 30
    $r | ConvertTo-Json -Depth 20
  }
} else {
  Write-Host ""
  Write-Host "---- Inbox Telegram en Cloudflare ----"
  Write-Host "Saltado: no pegaste la clave secreta."
}

if (!(Test-Path $keyPath)) {
  Write-Host ""
  Write-Host "No encuentro la private key en: $keyPath"
  Write-Host "No puedo revisar Oracle sin esa clave."
  exit 0
}

try {
  icacls $keyPath /inheritance:r | Out-Null
  icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null
} catch {}

$remote = @'
echo "---- Servicio Telegram Reader ----"
systemctl status mauex-telegram-reader --no-pager -l | head -n 35
echo
echo "---- Configuracion Telegram Reader ----"
if [ -f /opt/mauex-telegram/.env ]; then
  sudo grep -E "^(MAUEX_TELEGRAM_CHANNELS|MAUEX_TELEGRAM_BACKFILL|MAUEX_WORKER_URL|TELEGRAM_API_ID|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_INBOX_SECRET)=" /opt/mauex-telegram/.env \
    | sed -E "s/(TELEGRAM_WEBHOOK_SECRET=).+/\1***set***/;s/(TELEGRAM_INBOX_SECRET=).+/\1***set***/;s/(TELEGRAM_API_ID=).+/\1***set***/"
else
  echo "No existe /opt/mauex-telegram/.env"
fi
echo
echo "---- Sesion Telegram guardada ----"
if [ -s /opt/mauex-telegram/telegram.session ]; then echo "SI"; else echo "NO"; fi
echo
echo "---- Senales ya vistas por el lector ----"
if [ -f /opt/mauex-telegram/seen.json ]; then sudo tail -n 20 /opt/mauex-telegram/seen.json; else echo "No existe seen.json"; fi
echo
echo "---- Ultimos logs ----"
journalctl -u mauex-telegram-reader -n 120 --no-pager
'@

Show-Request "Oracle Telegram Reader" {
  ssh -i $keyPath -o StrictHostKeyChecking=accept-new "ubuntu@$ip" $remote
}

Write-Host ""
Write-Host "Como leer el resultado:"
Write-Host "- Si Cloudflare health esta ok y el inbox responde, el Worker esta bien."
Write-Host "- Si el servicio en Oracle no esta active/running, el automatico esta detenido."
Write-Host "- Si dice 'Canales monitoreados: ninguno', la cuenta de Telegram no esta viendo esos canales."
Write-Host "- Si en logs aparece 'Worker rechazo', Cloudflare esta rechazando lo que Oracle envia."
Write-Host "- Si no hay logs de 'Senal enviada' cuando el canal publico una senal nueva, el corte esta en Oracle/Telegram."

