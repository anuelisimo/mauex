$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$user = "ubuntu"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "oracle"
$backendFile = Join-Path $backendDir "mauex-binance-backend.js"
$installerFile = Join-Path $backendDir "instalar-en-oracle.sh"

Write-Host ""
Write-Host "============================================"
Write-Host "  MAUex - actualizar backend Oracle"
Write-Host "============================================"
Write-Host ""
Write-Host "IP de Oracle: $ip"
Write-Host ""

if (!(Test-Path $backendFile) -or !(Test-Path $installerFile)) {
  throw "No encuentro los archivos del backend en $backendDir"
}

$defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
$keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) {
  throw "No encuentro la private key en: $keyPath"
}

Write-Host ""
Write-Host "Ajustando permisos de la private key..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
Write-Host "Subiendo backend corregido a Oracle..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-oracle"
scp -i $keyPath -o StrictHostKeyChecking=accept-new $backendFile $installerFile "${user}@${ip}:/tmp/mauex-oracle/"

Write-Host ""
Write-Host "Instalando y reiniciando servicio. No se modifican las claves guardadas..."
$remoteCommand = @"
set -e
cd /tmp/mauex-oracle
sudo bash instalar-en-oracle.sh
sudo cp /tmp/mauex-oracle/mauex-binance-backend.js /opt/mauex-binance/mauex-binance-backend.js
sudo grep -q "ibkr-balance" /opt/mauex-binance/mauex-binance-backend.js
sudo systemctl restart mauex-binance
sleep 2
sudo systemctl status mauex-binance --no-pager -l | head -n 20
echo "CHECK_IBKR_ENDPOINT_OK"
"@
$remoteOneLine = $remoteCommand -replace "`r?`n", " && "
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" $remoteOneLine

Write-Host ""
Write-Host "Probando endpoints..."
Start-Sleep -Seconds 3

function Test-Url($title, $url) {
  Write-Host ""
  Write-Host "---- $title ----"
  Write-Host $url
  try {
    $r = Invoke-RestMethod $url -TimeoutSec 30
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
Test-Url "Binance" "$base/binance-balance"
Test-Url "KuCoin" "$base/kucoin-balance"
Test-Url "IBKR Flex" "$base/ibkr-flex-balance"
Test-Url "IBKR" "$base/ibkr-balance"
Test-Url "IBKR debug" "$base/ibkr-debug"

Write-Host ""
Write-Host "Listo. Ahora ejecuta MAUEX_SUBIR_FIX_DASH_WORKER.bat para subir frontend/worker."
Write-Host ""
Read-Host "Presiona Enter para cerrar"


