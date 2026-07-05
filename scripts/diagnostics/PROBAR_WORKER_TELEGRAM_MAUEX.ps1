$ErrorActionPreference = "Continue"

$workerUrl = Read-Host "URL del Worker [Enter = https://mauex-proxy.mauaparo.workers.dev]"
if ([string]::IsNullOrWhiteSpace($workerUrl)) { $workerUrl = "https://mauex-proxy.mauaparo.workers.dev" }
$workerUrl = $workerUrl.TrimEnd("/")

$secret = Read-Host "Pega TELEGRAM_WEBHOOK_SECRET / TELEGRAM_INBOX_SECRET"
if ([string]::IsNullOrWhiteSpace($secret)) {
  Write-Host "Falta la clave secreta."
  exit 1
}

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

Show-Request "Health" {
  $r = Invoke-RestMethod "$workerUrl/health?t=$(Get-Date -UFormat %s)" -TimeoutSec 30
  $r | ConvertTo-Json -Depth 20
}

$payload = @{
  update_id = [int](Get-Random -Minimum 100000 -Maximum 999999999)
  channel_post = @{
    message_id = [int](Get-Random -Minimum 100000 -Maximum 999999999)
    date = [int][double]::Parse((Get-Date -UFormat %s))
    chat = @{
      id = -1001234567890
      title = "Binance Killers VIP"
      type = "channel"
    }
    text = @"
SIGNAL ID: #999999
COIN: `$TEST/USDT (2-5x)
Direction: LONG
ENTRY: 1.00 - 1.01
TARGETS: 1.10 - 1.20 - 1.30
STOP LOSS: 0.90
"@
    caption = $null
  }
} | ConvertTo-Json -Depth 20

Show-Request "Enviar senal de prueba al webhook" {
  $r = Invoke-RestMethod "$workerUrl/telegram-webhook" -Method Post -Headers @{
    "X-Telegram-Bot-Api-Secret-Token" = $secret
  } -ContentType "application/json" -Body $payload -TimeoutSec 30
  $r | ConvertTo-Json -Depth 20
}

Show-Request "Leer inbox Telegram" {
  $encoded = [uri]::EscapeDataString($secret)
  $r = Invoke-RestMethod "$workerUrl/telegram-signals?secret=$encoded&t=$(Get-Date -UFormat %s)" -TimeoutSec 30
  $r | ConvertTo-Json -Depth 20
}

Write-Host ""
Write-Host "Si el webhook devuelve ok:true, Cloudflare esta bien y el problema queda en Oracle."
Write-Host "Si devuelve HTML, 404, 500 o Forbidden, el problema esta en Worker/variables Cloudflare."
