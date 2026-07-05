$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
$keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

$model = Read-Host "Modelo visual local [Enter = moondream]"
if ([string]::IsNullOrWhiteSpace($model)) { $model = "moondream" }

$user = "ubuntu"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "oracle-binance-backend"
$backendFile = Join-Path $backendDir "mauex-binance-backend.js"
$installerFile = Join-Path $backendDir "instalar-en-oracle.sh"

if (!(Test-Path $backendFile) -or !(Test-Path $installerFile)) {
  throw "No encuentro los archivos del backend en $backendDir"
}

Write-Host ""
Write-Host "Ajustando permisos de la private key..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
Write-Host "Subiendo backend actualizado a Oracle..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-oracle"
scp -i $keyPath -o StrictHostKeyChecking=accept-new $backendFile $installerFile "${user}@${ip}:/tmp/mauex-oracle/"

$remote = @"
set -e
cd /tmp/mauex-oracle
sudo bash instalar-en-oracle.sh
sudo cp /tmp/mauex-oracle/mauex-binance-backend.js /opt/mauex-binance/mauex-binance-backend.js

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

sudo systemctl enable ollama >/dev/null 2>&1 || true
sudo systemctl restart ollama || true
sleep 4

ollama pull "$model"

sudo touch /opt/mauex-binance/.env
sudo sed -i '/^SIGNAL_AI_PROVIDER=/d;/^SIGNAL_AI_MODEL=/d;/^SIGNAL_AI_BASE_URL=/d' /opt/mauex-binance/.env
printf '\nSIGNAL_AI_PROVIDER=ollama\nSIGNAL_AI_MODEL=%s\nSIGNAL_AI_BASE_URL=http://127.0.0.1:11434\n' "$model" | sudo tee -a /opt/mauex-binance/.env >/dev/null

sudo systemctl restart mauex-binance
sleep 3
sudo systemctl status mauex-binance --no-pager -l | head -n 25
"@

Write-Host ""
Write-Host "Instalando modelo visual local. Puede tardar varios minutos la primera vez..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" ($remote -replace "`r?`n", " && ")

function Test-Url($title, $url, $body = $null) {
  Write-Host ""
  Write-Host "---- $title ----"
  Write-Host $url
  try {
    if ($null -eq $body) {
      $r = Invoke-RestMethod $url -TimeoutSec 45
    } else {
      $r = Invoke-RestMethod $url -Method Post -ContentType "application/json" -Body $body -TimeoutSec 120
    }
    Write-Host ($r | ConvertTo-Json -Compress -Depth 20)
  } catch {
    Write-Host "ERROR:" $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Write-Host "BODY:" $_.ErrorDetails.Message
    }
  }
}

$base = "http://mauex-binance.$ip.nip.io:8080"
Test-Url "Health" "$base/health"

$testPayload = @{
  sourceName = "Binance Killers"
  raw = "SIGNAL ID: #2141`nCOIN: ALGO/USDT (2-5x)`nDirection: LONG`nENTRY: 0.1090 - 0.1100`nTARGETS: 0.1150 - 0.1200`nSTOP LOSS: 0.1000"
} | ConvertTo-Json -Compress
Test-Url "AI visual local" "$base/signal-vision-ai" $testPayload

Write-Host ""
Write-Host "Listo. Ahora ejecuta ACTUALIZAR_CANALES_TELEGRAM_READER_MAUEX.bat para que el lector suba imagenes nuevas."
Write-Host "Luego ejecuta MAUEX_SUBIR_FIX_DASH_WORKER.bat para copiar el Worker actualizado y pegarlo en Cloudflare."
Write-Host ""
Read-Host "Presiona Enter para cerrar"


