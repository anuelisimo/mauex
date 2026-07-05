$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "============================================"
Write-Host "  MAUex - probar exchanges Dashboard"
Write-Host "============================================"
Write-Host ""
Write-Host "Este archivo no modifica nada. Solo consulta Oracle y Cloudflare."
Write-Host ""

$worker = "https://mauex-proxy.mauaparo.workers.dev"
$oracle = "http://mauex-binance.146.235.243.105.nip.io:8080"

function Show-JsonCall {
  param(
    [string]$Title,
    [string]$Url,
    [int]$Timeout = 30
  )

  Write-Host ""
  Write-Host "---- $Title ----"
  Write-Host $Url
  try {
    $result = Invoke-RestMethod $Url -TimeoutSec $Timeout
    $json = $result | ConvertTo-Json -Depth 30
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

Show-JsonCall "Cloudflare health" "$worker/health?t=$(Get-Date -UFormat %s)" 30
Show-JsonCall "Cloudflare balance live" "$worker/balance?live=1&t=$(Get-Date -UFormat %s)" 60

Show-JsonCall "Oracle health" "$oracle/health" 30
Show-JsonCall "Oracle Binance" "$oracle/binance-balance" 30
Show-JsonCall "Oracle KuCoin" "$oracle/kucoin-balance" 30
Show-JsonCall "Oracle IBKR" "$oracle/ibkr-balance" 30

Write-Host ""
Write-Host "Que mirar:"
Write-Host "- En Cloudflare health, version deberia ser 2026-06-02-capital-telegram-v4."
Write-Host "- En keys, binanceBackend, kucoinBackend e ibkrBackend deberian estar en true."
Write-Host "- En Cloudflare balance live deberian aparecer BINANCE, BYBIT, OKX, MEXC, KUCOIN e IBKR."
Write-Host "- errors deberia venir vacio o sin errores importantes."
Write-Host "- Si Oracle Binance esta bien pero Cloudflare no, falta pegar/deployar el Worker nuevo."
Write-Host ""
Read-Host "Presiona Enter para cerrar"
