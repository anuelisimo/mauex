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
  $proxyTargets = @(
    'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=2',
    'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1h&range=1d'
  )
  $proxyOk = $false
  foreach ($target in $proxyTargets) {
    $chartUrl = [uri]::EscapeDataString($target)
    try {
      $proxy = Invoke-WebRequest -UseBasicParsing -Uri "https://mauex-proxy.mauaparo.workers.dev/proxy?url=$chartUrl&t=$stamp" -Headers $headers -TimeoutSec 30
      Write-Host ("Proxy OK: " + ([uri]$target).Host + " status=" + $proxy.StatusCode + " bytes=" + $proxy.Content.Length)
      $proxyOk = $true
      break
    } catch {
      $status = ''
      $body = ''
      if ($_.Exception.Response) {
        try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        try {
          $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
          $body = $reader.ReadToEnd()
        } catch {}
      }
      Write-Host ("Proxy aviso: " + ([uri]$target).Host + " status=" + $status + " " + $body.Substring(0, [Math]::Min(180, $body.Length))) -ForegroundColor Yellow
    }
  }
  if (-not $proxyOk) {
    Write-Host "El Worker deployo bien, pero los proveedores publicos de velas devolvieron bloqueo temporal. No marco el deploy como fallido por esto." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Listo. Si Vercel ya deployo el frontend, recarga MAUex con Ctrl+F5." -ForegroundColor Green
