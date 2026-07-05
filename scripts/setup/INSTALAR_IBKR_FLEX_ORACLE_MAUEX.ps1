$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$user = "ubuntu"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "oracle-binance-backend"
$backendFile = Join-Path $backendDir "mauex-binance-backend.js"
$installerFile = Join-Path $backendDir "instalar-en-oracle.sh"
$hostName = "mauex-binance.$ip.nip.io"

Write-Host ""
Write-Host "============================================"
Write-Host "  MAUex - configurar IBKR Flex Web"
Write-Host "============================================"
Write-Host ""
Write-Host "Necesitas tener en IBKR:"
Write-Host "  - Flex Web Service activo"
Write-Host "  - Current Token"
Write-Host "  - Query ID de una Activity Flex Query en XML"
Write-Host ""
Write-Host "Si IBKR te pide restringir por IP, usa esta IP de Oracle: $ip"
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

$flexToken = Read-Host "Pega el Current Token de IBKR Flex"
$flexToken = $flexToken.Trim()
if ([string]::IsNullOrWhiteSpace($flexToken)) {
  throw "Falta el Current Token de IBKR Flex"
}

$flexQueryId = Read-Host "Pega el Query ID de la Flex Query"
$flexQueryId = $flexQueryId.Trim()
if ([string]::IsNullOrWhiteSpace($flexQueryId)) {
  throw "Falta el Query ID de IBKR Flex"
}

$cacheHours = Read-Host "Cada cuantas horas refrescar IBKR [Enter = 20]"
if ([string]::IsNullOrWhiteSpace($cacheHours)) { $cacheHours = "20" }

Write-Host ""
Write-Host "Ajustando permisos de la private key..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

$tempId = [Guid]::NewGuid().ToString("N")
$tempEnv = Join-Path $env:TEMP "mauex-ibkr-flex-$tempId.env"
$tempRemoteScript = Join-Path $env:TEMP "mauex-install-ibkr-flex-$tempId.sh"

$envText = @"
IBKR_FLEX_TOKEN=$flexToken
IBKR_FLEX_QUERY_ID=$flexQueryId
IBKR_FLEX_CACHE_HOURS=$cacheHours
"@

$remoteScript = @'
set -e
cd /tmp/mauex-oracle
sudo bash instalar-en-oracle.sh
sudo cp /tmp/mauex-oracle/mauex-binance-backend.js /opt/mauex-binance/mauex-binance-backend.js
sudo touch /opt/mauex-binance/.env
sudo sh -c "grep -v '^IBKR_FLEX_' /opt/mauex-binance/.env > /tmp/mauex-env && cat /tmp/mauex-oracle/ibkr-flex.env >> /tmp/mauex-env && cp /tmp/mauex-env /opt/mauex-binance/.env && chmod 600 /opt/mauex-binance/.env"
sudo rm -f /opt/mauex-binance/ibkr-flex-cache.json
sudo systemctl restart mauex-binance
sleep 2
sudo systemctl status mauex-binance --no-pager -l | head -n 20
'@

try {
  Set-Content -Path $tempEnv -Value $envText -Encoding ASCII -NoNewline
  Set-Content -Path $tempRemoteScript -Value $remoteScript -Encoding ASCII -NoNewline

  Write-Host ""
  Write-Host "Subiendo backend actualizado a Oracle..."
  ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-oracle"
  scp -i $keyPath -o StrictHostKeyChecking=accept-new $backendFile $installerFile "${user}@${ip}:/tmp/mauex-oracle/"
  scp -i $keyPath -o StrictHostKeyChecking=accept-new $tempEnv "${user}@${ip}:/tmp/mauex-oracle/ibkr-flex.env"
  scp -i $keyPath -o StrictHostKeyChecking=accept-new $tempRemoteScript "${user}@${ip}:/tmp/mauex-oracle/instalar-ibkr-flex.sh"

  Write-Host ""
  Write-Host "Guardando token Flex en Oracle y reiniciando MAUex..."
  ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "bash /tmp/mauex-oracle/instalar-ibkr-flex.sh"

  Write-Host ""
  Write-Host "Probando IBKR Flex. La primera vez puede tardar unos segundos..."
  Start-Sleep -Seconds 3

  function Test-Url($title, $url) {
    Write-Host ""
    Write-Host "---- $title ----"
    Write-Host $url
    try {
      $r = Invoke-RestMethod $url -TimeoutSec 45
      Write-Host ($r | ConvertTo-Json -Compress -Depth 20)
      return $r
    } catch {
      Write-Host "ERROR:" $_.Exception.Message
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "BODY:" $_.ErrorDetails.Message
      }
      return $null
    }
  }

  Test-Url "Health" "http://${hostName}:8080/health"
  Test-Url "IBKR Flex" "http://${hostName}:8080/ibkr-flex-balance?live=1"
  Test-Url "IBKR Dashboard endpoint" "http://${hostName}:8080/ibkr-balance"

  Write-Host ""
  Write-Host "Listo. Si IBKR Flex devuelve capital, el Dashboard lo va a tomar desde Cloudflare en el proximo refresh."
  Write-Host "Si Cloudflare todavia no lo muestra, ejecuta MAUEX_SUBIR_FIX_DASH_WORKER.bat y pega el Worker en Cloudflare."
} finally {
  Remove-Item -LiteralPath $tempEnv -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tempRemoteScript -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Read-Host "Presiona Enter para cerrar"


