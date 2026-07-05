$ErrorActionPreference = 'Continue'

Write-Host ''
Write-Host '============================================'
Write-Host '  MAUex - probar Capital / Worker'
Write-Host '============================================'
Write-Host ''

$defaultUrl = 'https://mauex-proxy.mauaparo.workers.dev'
$workerUrl = Read-Host "URL del Worker [Enter = $defaultUrl]"
if ([string]::IsNullOrWhiteSpace($workerUrl)) { $workerUrl = $defaultUrl }
$workerUrl = $workerUrl.TrimEnd('/')

function Read-JsonUrl($label, $url) {
  Write-Host ''
  Write-Host "---- $label ----"
  Write-Host $url
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 45
    $text = $res.Content
    Write-Host $text
    try { return $text | ConvertFrom-Json } catch { return $null }
  } catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Write-Host "BODY: $($_.ErrorDetails.Message)"
    }
    return $null
  }
}

$health = Read-JsonUrl 'Health' "$workerUrl/health"
$balance = Read-JsonUrl 'Balance live' "$workerUrl/balance?live=1&t=$(Get-Date -UFormat %s)"

Write-Host ''
Write-Host '---- Diagnostico rapido ----'
if ($null -eq $health) {
  Write-Host 'No pude leer /health.'
} else {
  Write-Host "Version: $($health.version)"
  Write-Host "KV activo: $($health.hasKV)"
  if ($health.keys) {
    $health.keys.PSObject.Properties | ForEach-Object {
      Write-Host ("{0}: {1}" -f $_.Name, $_.Value)
    }
  }
}

if ($null -eq $balance) {
  Write-Host 'No pude leer /balance.'
} elseif ($balance.totals) {
  Write-Host ("Total reportado: ${0}" -f $balance.totals.total)
  if ($balance.balances) {
    Write-Host ("Exchanges leidos: {0}" -f (($balance.balances.PSObject.Properties | Select-Object -ExpandProperty Name) -join ', '))
  }
}

Write-Host ''
Write-Host 'Esperado para que MAUex funcione:'
Write-Host '- hasKV = True'
Write-Host '- binanceBackend / kucoinBackend / ibkrBackend = True'
Write-Host '- bybit / okx / mexc = True si queres esos balances'
Write-Host '- balance total mayor a 0'
