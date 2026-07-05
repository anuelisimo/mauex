$ErrorActionPreference = "Stop"

Write-Host "============================================"
Write-Host "  MAUex - probar AI visual Oracle"
Write-Host "============================================"
Write-Host ""

$base = Read-Host "URL Oracle [Enter = http://mauex-binance.146.235.243.105.nip.io:8080]"
if ([string]::IsNullOrWhiteSpace($base)) {
  $base = "http://mauex-binance.146.235.243.105.nip.io:8080"
}
$base = $base.TrimEnd("/")

Write-Host ""
Write-Host "---- Health Oracle ----"
try {
  $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 20
  $health | ConvertTo-Json -Depth 8
} catch {
  Write-Host "ERROR health: $($_.Exception.Message)" -ForegroundColor Red
}

$raw = @"
killa
64.4-65.6K is the area for scalp shorts. Not really interested in middle range.

Prefer to wait for the sweep. Good zone for a SL would be 67.5K with target sub-60K.
"@

Write-Host ""
Write-Host "---- AI visual / lectura de señal ----"
try {
  $body = @{
    raw = $raw
    sourceName = "Killa"
  } | ConvertTo-Json -Depth 8
  $ai = Invoke-RestMethod -Uri "$base/signal-vision-ai" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60
  $ai | ConvertTo-Json -Depth 12
} catch {
  Write-Host "ERROR AI: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
}

Write-Host ""
Write-Host "Que mirar:"
Write-Host "- provider/model deberia decir ollama/moondream si la VM visual esta activa."
Write-Host "- usedImage sera false en esta prueba porque solo probamos texto."
Write-Host "- Si aparece warning de AI local no disponible, la VM no esta usando el modelo."
