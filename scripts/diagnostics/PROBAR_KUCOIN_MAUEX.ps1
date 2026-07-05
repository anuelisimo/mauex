$ErrorActionPreference = "Continue"

$oracle = "http://mauex-binance.146.235.243.105.nip.io:8080"
$worker = "https://mauex-proxy.mauaparo.workers.dev"

function Show-JsonCall {
  param(
    [string]$Title,
    [string]$Url,
    [int]$Timeout = 25
  )

  Write-Host ""
  Write-Host "---- $Title ----"
  Write-Host $Url
  try {
    $result = Invoke-RestMethod $Url -TimeoutSec $Timeout
    $json = $result | ConvertTo-Json -Compress -Depth 10
    Write-Host $json
  } catch {
    Write-Host "ERROR:" $_.Exception.Message
    try {
      if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        if ($body) { Write-Host "BODY:" $body }
      }
    } catch {}
  }
}

Write-Host ""
Write-Host "Probando desde esta PC..."

Show-JsonCall "Oracle health" "$oracle/health" 20
Show-JsonCall "Oracle KuCoin" "$oracle/kucoin-balance" 30
Show-JsonCall "Oracle KuCoin debug" "$oracle/kucoin-debug" 30
Show-JsonCall "Cloudflare health" "$worker/health" 20
Show-JsonCall "Cloudflare balance live" "$worker/balance?live=1" 35

Write-Host ""
Write-Host "Que mirar:"
Write-Host "- Si Oracle KuCoin tiene error, el problema esta en Oracle o en las claves de KuCoin."
Write-Host "- Si Oracle KuCoin esta bien pero Cloudflare no, falta variable/deploy del Worker."
Write-Host "- Si Cloudflare balance live muestra KUCOIN dentro de balances, la sync ya esta llegando al dashboard."
Write-Host ""
Read-Host "Presiona Enter para cerrar"
