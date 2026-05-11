$ErrorActionPreference = "Continue"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$oracleBase = "http://mauex-binance.$ip.nip.io:8080"
$workerBase = "https://mauex-proxy.mauaparo.workers.dev"

Write-Host ""
Write-Host "Este archivo no modifica nada. Solo prueba dashboard, Oracle y Cloudflare."
Write-Host ""

function Test-Url($title, $url) {
  Write-Host ""
  Write-Host "---- $title ----"
  Write-Host $url
  try {
    $r = Invoke-RestMethod $url -TimeoutSec 30
    $json = $r | ConvertTo-Json -Compress -Depth 20
    Write-Host $json
    return $r
  } catch {
    Write-Host "ERROR:" $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Write-Host "BODY:" $_.ErrorDetails.Message
    }
    return $null
  }
}

$workerHealth = Test-Url "Cloudflare health" "$workerBase/health"
$workerBalance = Test-Url "Cloudflare balance live" "$workerBase/balance?live=1"
$oracleHealth = Test-Url "Oracle health" "$oracleBase/health"
$oracleIp = Test-Url "Oracle public IP" "$oracleBase/myip"
$binance = Test-Url "Oracle Binance" "$oracleBase/binance-balance"
$kucoin = Test-Url "Oracle KuCoin" "$oracleBase/kucoin-balance"
$ibkrHealth = Test-Url "Oracle IBKR health" "$oracleBase/ibkr-health"
$ibkrBalance = Test-Url "Oracle IBKR balance" "$oracleBase/ibkr-balance"
$ibkrDebug = Test-Url "Oracle IBKR debug" "$oracleBase/ibkr-debug"

Write-Host ""
Write-Host "Diagnostico rapido:"
if (!$oracleHealth) {
  Write-Host "- Oracle no responde en esta IP. Puede estar apagado, haber cambiado la IP publica o estar bloqueado el puerto 8080."
}
if ($oracleIp -and $oracleIp.ip) {
  Write-Host "- IP que ve internet para Oracle: $($oracleIp.ip)"
  Write-Host "  Esa IP debe estar en la whitelist de Binance si la key tiene restriccion por IP."
}
if ($binance -and $binance.error) {
  Write-Host "- Binance devolvio error: $($binance.error)"
  if (($binance.error + "") -match "-2015|Invalid API-key|IP") {
    Write-Host "  Esto suele ser whitelist de IP o permisos de la API key."
  }
}
if ($workerHealth -and $workerHealth.binanceBackendUrl) {
  Write-Host "- Cloudflare apunta a Binance backend: $($workerHealth.binanceBackendUrl)"
}
if ($workerBalance -and $workerBalance.errors) {
  Write-Host "- Errores reportados por Cloudflare: $(($workerBalance.errors | ConvertTo-Json -Compress -Depth 10))"
}
if ($ibkrBalance -and $ibkrBalance.error) {
  Write-Host "- IBKR devolvio error: $($ibkrBalance.error)"
  Write-Host "  IBKR requiere Client Portal Gateway abierto y logueado en Oracle."
}

Write-Host ""
Write-Host "Mandale a Codex captura de toda esta ventana si algo aparece con ERROR."
Write-Host ""
Read-Host "Presiona Enter para cerrar"
