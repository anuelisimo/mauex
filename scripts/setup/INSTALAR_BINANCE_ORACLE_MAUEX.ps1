$ErrorActionPreference = "Stop"

$ip = "146.235.243.105"
$user = "ubuntu"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "oracle-binance-backend"
$backendFile = Join-Path $backendDir "mauex-binance-backend.js"
$installerFile = Join-Path $backendDir "instalar-en-oracle.sh"

Write-Host ""
Write-Host "============================================"
Write-Host "  MAUex - instalar Binance en Oracle"
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
Write-Host "Voy a ajustar permisos de la private key para que Windows permita usarla..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
Write-Host "Subiendo backend a Oracle..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-oracle"
scp -i $keyPath -o StrictHostKeyChecking=accept-new $backendFile $installerFile "${user}@${ip}:/tmp/mauex-oracle/"

Write-Host ""
Write-Host "Instalando Node y servicio de MAUex en Oracle. Puede tardar unos minutos..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "cd /tmp/mauex-oracle && sudo bash instalar-en-oracle.sh"

Write-Host ""
$binanceKey = Read-Host "Pega BINANCE_KEY"
$secureSecret = Read-Host "Pega BINANCE_SECRET" -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $binanceSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
}

$envText = "BINANCE_KEY=$binanceKey`nBINANCE_SECRET=$binanceSecret`nPORT=8080`n"
$envB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($envText))

Write-Host ""
Write-Host "Guardando las claves dentro de Oracle y reiniciando el servicio..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "echo '$envB64' | base64 -d | sudo tee /opt/mauex-binance/.env >/dev/null && sudo chmod 600 /opt/mauex-binance/.env && sudo systemctl restart mauex-binance && sudo systemctl status mauex-binance --no-pager -l | head -n 20"

Write-Host ""
Write-Host "Probando servicio..."
Start-Sleep -Seconds 3

try {
  $health = Invoke-RestMethod "http://${ip}:8080/health" -TimeoutSec 20
  Write-Host "Health OK:" ($health | ConvertTo-Json -Compress)
} catch {
  Write-Host "No pude abrir /health desde Windows. Puede faltar abrir el puerto 8080 en Oracle."
  Write-Host $_.Exception.Message
}

try {
  $myip = Invoke-RestMethod "http://${ip}:8080/myip" -TimeoutSec 20
  Write-Host "IP que ve internet:" ($myip | ConvertTo-Json -Compress)
} catch {
  Write-Host "No pude abrir /myip desde Windows."
}

try {
  $balance = Invoke-RestMethod "http://${ip}:8080/binance-balance" -TimeoutSec 20
  Write-Host "Respuesta Binance:" ($balance | ConvertTo-Json -Compress)
} catch {
  Write-Host "No pude leer /binance-balance desde Windows."
  Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "Siguiente paso si Binance responde bien:"
Write-Host "En Cloudflare Worker agregar BINANCE_BACKEND_URL=http://${ip}:8080"
Write-Host ""
Read-Host "Presiona Enter para cerrar"


