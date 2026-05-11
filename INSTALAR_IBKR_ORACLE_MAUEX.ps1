$ErrorActionPreference = "Stop"

$ip = "146.235.243.105"
$hostName = "mauex-binance.146.235.243.105.nip.io"
$user = "ubuntu"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "oracle-binance-backend"
$backendFile = Join-Path $backendDir "mauex-binance-backend.js"
$installerFile = Join-Path $backendDir "instalar-en-oracle.sh"

Write-Host ""
Write-Host "============================================"
Write-Host "  MAUex - agregar IBKR a Oracle"
Write-Host "============================================"
Write-Host ""
Write-Host "Esto actualiza el backend de Oracle para que MAUex pueda leer capital de IBKR."
Write-Host "No importa posiciones ni ordenes a MAUex."
Write-Host ""

if (!(Test-Path $backendFile) -or !(Test-Path $installerFile)) {
  throw "No encuentro los archivos del backend en $backendDir"
}

$keyPath = Read-Host "Arrastra aca la private key de Oracle y presiona Enter"
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) {
  throw "No encuentro la private key en: $keyPath"
}

Write-Host ""
Write-Host "Voy a ajustar permisos de la private key para que Windows permita usarla..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
$gatewayUrl = Read-Host "IBKR Gateway URL en Oracle [Enter = https://127.0.0.1:5000]"
if ([string]::IsNullOrWhiteSpace($gatewayUrl)) { $gatewayUrl = "https://127.0.0.1:5000" }
$accountId = Read-Host "IBKR Account ID opcional [Enter = usar el primero]"

$tempId = [Guid]::NewGuid().ToString("N")
$tempEnv = Join-Path $env:TEMP "mauex-ibkr-$tempId.env"
$tempRemoteScript = Join-Path $env:TEMP "mauex-install-ibkr-$tempId.sh"

$envText = "IBKR_GATEWAY_URL=$gatewayUrl`nIBKR_ACCOUNT_ID=$accountId`nIBKR_ALLOW_SELF_SIGNED=1`n"
$remoteScript = @'
set -e
cd /tmp/mauex-oracle
sudo bash instalar-en-oracle.sh
sudo touch /opt/mauex-binance/.env
sudo sh -c "grep -v '^IBKR_' /opt/mauex-binance/.env > /tmp/mauex-env && cat /tmp/mauex-oracle/ibkr.env >> /tmp/mauex-env && cp /tmp/mauex-env /opt/mauex-binance/.env && chmod 600 /opt/mauex-binance/.env"
sudo systemctl restart mauex-binance
sudo systemctl status mauex-binance --no-pager -l | head -n 20
'@

try {
  Set-Content -Path $tempEnv -Value $envText -Encoding ASCII -NoNewline
  Set-Content -Path $tempRemoteScript -Value $remoteScript -Encoding ASCII -NoNewline

  Write-Host ""
  Write-Host "Subiendo backend actualizado a Oracle..."
  ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-oracle"
  scp -i $keyPath -o StrictHostKeyChecking=accept-new $backendFile $installerFile "${user}@${ip}:/tmp/mauex-oracle/"
  scp -i $keyPath -o StrictHostKeyChecking=accept-new $tempEnv "${user}@${ip}:/tmp/mauex-oracle/ibkr.env"
  scp -i $keyPath -o StrictHostKeyChecking=accept-new $tempRemoteScript "${user}@${ip}:/tmp/mauex-oracle/instalar-ibkr.sh"

  Write-Host ""
  Write-Host "Instalando soporte IBKR en Oracle..."
  ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "bash /tmp/mauex-oracle/instalar-ibkr.sh"

  Write-Host ""
  Write-Host "Probando servicio MAUex..."
  Start-Sleep -Seconds 3

  $health = Invoke-RestMethod "http://${hostName}:8080/health" -TimeoutSec 20
  Write-Host "Health OK:" ($health | ConvertTo-Json -Compress)

  Write-Host ""
  Write-Host "Probando IBKR..."
  try {
    $ibkr = Invoke-RestMethod "http://${hostName}:8080/ibkr-balance" -TimeoutSec 25
    Write-Host "Respuesta IBKR:" ($ibkr | ConvertTo-Json -Compress)
  } catch {
    Write-Host "IBKR todavia no respondio. Puede faltar iniciar sesion en IBKR Client Portal Gateway."
    Write-Host $_.Exception.Message
  }

  Write-Host ""
  Write-Host "Siguiente paso:"
  Write-Host "1) Copia el Worker con COPIAR_WORKER_CLOUDFLARE.bat y pegalo en Cloudflare."
  Write-Host "2) En Cloudflare, si BINANCE_BACKEND_URL ya apunta a http://${hostName}:8080, IBKR usa ese mismo backend."
  Write-Host "3) Si preferis variable separada, agrega IBKR_BACKEND_URL=http://${hostName}:8080"
} finally {
  Remove-Item -LiteralPath $tempEnv -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tempRemoteScript -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($env:MAUEX_AUTO -ne "1") {
  Read-Host "Presiona Enter para cerrar"
}
