$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
$keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

$apiId = Read-Host "Pega TELEGRAM_API_ID de my.telegram.org"
if ([string]::IsNullOrWhiteSpace($apiId)) { throw "Falta TELEGRAM_API_ID" }

$apiHash = Read-Host "Pega TELEGRAM_API_HASH de my.telegram.org"
if ([string]::IsNullOrWhiteSpace($apiHash)) { throw "Falta TELEGRAM_API_HASH" }

$secret = Read-Host "Pega TELEGRAM_WEBHOOK_SECRET / TELEGRAM_INBOX_SECRET"
if ([string]::IsNullOrWhiteSpace($secret)) { throw "Falta TELEGRAM_WEBHOOK_SECRET" }

$workerUrl = Read-Host "URL del Worker [Enter = https://mauex-proxy.mauaparo.workers.dev]"
if ([string]::IsNullOrWhiteSpace($workerUrl)) { $workerUrl = "https://mauex-proxy.mauaparo.workers.dev" }

$channels = Read-Host "Canales a leer [Enter = BinanceKillersVipOfficial,BitcoinBullets_VipOfficial]"
if ([string]::IsNullOrWhiteSpace($channels)) { $channels = "BinanceKillersVipOfficial,BitcoinBullets_VipOfficial" }

function EnvQuote($value) {
  $s = [string]$value
  $s = $s.Replace('\', '\\').Replace('"', '\"')
  return '"' + $s + '"'
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$readerDir = Join-Path $root "telegram-reader"
$files = @(
  (Join-Path $readerDir "mauex-telegram-reader.js"),
  (Join-Path $readerDir "package.json"),
  (Join-Path $readerDir "instalar-en-oracle.sh")
)
foreach ($f in $files) {
  if (!(Test-Path $f)) { throw "No encuentro archivo: $f" }
}

Write-Host ""
Write-Host "Ajustando permisos de la private key..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

$user = "ubuntu"
Write-Host ""
Write-Host "Subiendo lector a Oracle..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-telegram"
scp -i $keyPath -o StrictHostKeyChecking=accept-new $files "${user}@${ip}:/tmp/mauex-telegram/"

$envContent = @"
TELEGRAM_API_ID=$apiId
TELEGRAM_API_HASH=$(EnvQuote $apiHash)
TELEGRAM_WEBHOOK_SECRET=$(EnvQuote $secret)
MAUEX_WORKER_URL=$(EnvQuote $workerUrl)
MAUEX_TELEGRAM_CHANNELS=$(EnvQuote $channels)
MAUEX_TELEGRAM_BACKFILL=0
"@
$tmpEnv = Join-Path $env:TEMP ("mauex-telegram-" + [guid]::NewGuid().ToString("N") + ".env")
$envContent | Set-Content -LiteralPath $tmpEnv -Encoding ascii
scp -i $keyPath -o StrictHostKeyChecking=accept-new $tmpEnv "${user}@${ip}:/tmp/mauex-telegram/.env"
Remove-Item -LiteralPath $tmpEnv -Force

Write-Host ""
Write-Host "Instalando servicio en Oracle..."
$install = @"
set -e
sudo bash /tmp/mauex-telegram/instalar-en-oracle.sh
sudo cp /tmp/mauex-telegram/.env /opt/mauex-telegram/.env
sudo chown ubuntu:ubuntu /opt/mauex-telegram/.env
sudo chmod 600 /opt/mauex-telegram/.env
"@
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" ($install -replace "`r?`n", " && ")

Write-Host ""
Write-Host "Ahora viene el login de Telegram."
Write-Host "Te va a pedir telefono, codigo de Telegram y quizas password 2FA."
Write-Host "Cuando termine, el lector queda prendido solo en Oracle."
Write-Host ""
Write-Host "Iniciando lector por primera vez..."

ssh -tt -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "cd /opt/mauex-telegram && set -a && source ./.env && set +a && MAUEX_TELEGRAM_LOGIN_ONLY=1 node mauex-telegram-reader.js"

Write-Host ""
Write-Host "Activando servicio permanente..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "sudo systemctl restart mauex-telegram-reader && sudo systemctl status mauex-telegram-reader --no-pager -l | head -n 25"

Write-Host ""
Write-Host "Listo. Oracle ya puede leer Binance Killers y Bitcoin Bullets automaticamente."
Write-Host "Para ver estado luego: PROBAR_TELEGRAM_READER_ORACLE_MAUEX.bat"


