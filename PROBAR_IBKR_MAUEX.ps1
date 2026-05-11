$ErrorActionPreference = "Continue"

$oracleBase = "http://mauex-binance.146.235.243.105.nip.io:8080"
$workerBase = "https://mauex-proxy.mauaparo.workers.dev"

Write-Host ""
Write-Host "Este archivo no modifica nada. Solo prueba Oracle y Cloudflare."
Write-Host ""

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

Write-Host "Probando desde esta PC..."

Test-Url "Oracle health" "$oracleBase/health"
Test-Url "Oracle IBKR health" "$oracleBase/ibkr-health"
Test-Url "Oracle IBKR balance" "$oracleBase/ibkr-balance"
Test-Url "Cloudflare health" "$workerBase/health"
Test-Url "Cloudflare balance live" "$workerBase/balance?live=1"

Write-Host ""
Write-Host "Que mirar:"
Write-Host "- Si Oracle IBKR balance devuelve capital, Oracle ya esta leyendo IBKR."
Write-Host "- Si Oracle esta bien pero Cloudflare no muestra IBKR, falta copiar/deployar el Worker."
Write-Host "- Si dice no autenticado, hay que iniciar sesion en IBKR Client Portal Gateway."
Write-Host ""
if ($env:MAUEX_AUTO -ne "1") {
  Read-Host "Presiona Enter para cerrar"
}
