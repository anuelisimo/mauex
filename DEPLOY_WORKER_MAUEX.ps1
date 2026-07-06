$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

Write-Host ""
Write-Host "Validando codigo local..." -ForegroundColor Cyan
& npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw "npm run check fallo" }

Write-Host ""
Write-Host "Revisando login de Cloudflare..." -ForegroundColor Cyan
& npx.cmd wrangler whoami
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "No hay sesion activa de Cloudflare. Se va a abrir el login." -ForegroundColor Yellow
  & npx.cmd wrangler login
  if ($LASTEXITCODE -ne 0) { throw "wrangler login fallo" }
}

Write-Host ""
Write-Host "Deployando Worker mauex-proxy..." -ForegroundColor Cyan
& npx.cmd wrangler deploy --config wrangler.jsonc --keep-vars
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy fallo" }

Write-Host ""
Write-Host "Probando /health publicado..." -ForegroundColor Cyan
$stamp = Get-Date -Format yyyyMMddHHmmss
$health = Invoke-RestMethod -Uri "https://mauex-proxy.mauaparo.workers.dev/health?t=$stamp" -TimeoutSec 30
$health | ConvertTo-Json -Depth 6

$token = ''
$keysPath = Join-Path $PSScriptRoot 'MAUEX_API_KEYS.txt'
if (Test-Path -LiteralPath $keysPath) {
  $raw = Get-Content -LiteralPath $keysPath -Raw
  $m = [regex]::Match($raw, '(?m)^MAUEX_API_TOKEN=(.+)$')
  if ($m.Success) { $token = $m.Groups[1].Value.Trim() }
}
if (-not $token) {
  $token = Read-Host "MAUEX_API_TOKEN para probar /ops-health [Enter para omitir]"
}

if ($token) {
  Write-Host ""
  Write-Host "Probando /ops-health autenticado..." -ForegroundColor Cyan
  $headers = @{ Authorization = "Bearer $token" }
  $ops = Invoke-RestMethod -Uri "https://mauex-proxy.mauaparo.workers.dev/ops-health?t=$stamp" -Headers $headers -TimeoutSec 30
  [pscustomobject]@{
    worker = $ops.worker.status
    version = $ops.worker.version
    readerAlive = $ops.reader.alive
    errors24h = $ops.errors24h
  } | ConvertTo-Json -Depth 6

  Write-Host ""
  Write-Host "Probando /proxy para charts..." -ForegroundColor Cyan
  $chartUrl = [uri]::EscapeDataString('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=2')
  $proxy = Invoke-WebRequest -UseBasicParsing -Uri "https://mauex-proxy.mauaparo.workers.dev/proxy?url=$chartUrl&t=$stamp" -Headers $headers -TimeoutSec 30
  Write-Host ("Proxy status: " + $proxy.StatusCode + " bytes=" + $proxy.Content.Length)
}

Write-Host ""
Write-Host "Listo. Si Vercel ya deployo el frontend, recarga MAUex con Ctrl+F5." -ForegroundColor Green
