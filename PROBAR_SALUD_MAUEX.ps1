$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$keysPath = Join-Path $root "MAUEX_API_KEYS.txt"

function Read-KeyValue($key) {
  if (!(Test-Path $keysPath)) { return "" }
  $raw = Get-Content -LiteralPath $keysPath -Raw
  $m = [regex]::Match($raw, "(?m)^$([regex]::Escape($key))=(.+)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

function Title($text) {
  Write-Host ""
  Write-Host "============================================"
  Write-Host "  $text"
  Write-Host "============================================"
}

$token = Read-KeyValue "MAUEX_API_TOKEN"
$workerUrl = Read-KeyValue "MAUEX_WORKER_URL"
if ([string]::IsNullOrWhiteSpace($workerUrl)) { $workerUrl = "https://mauex-proxy.mauaparo.workers.dev" }

$railwayUrl = Read-KeyValue "RAILWAY_URL"
$oracleUrl = Read-KeyValue "BINANCE_BACKEND_URL"
if ([string]::IsNullOrWhiteSpace($oracleUrl)) { $oracleUrl = Read-KeyValue "ORACLE_BACKEND_URL" }

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "No encuentro MAUEX_API_TOKEN en MAUEX_API_KEYS.txt"
}

$checks = @(
  @{ name = "Worker /health"; url = "$workerUrl/health"; auth = $false; expect = 200 },
  @{ name = "Worker /balance sin token"; url = "$workerUrl/balance"; auth = $false; expect = 401 },
  @{ name = "Worker /balance con token"; url = "$workerUrl/balance"; auth = $true; expect = 200 }
)

if (![string]::IsNullOrWhiteSpace($railwayUrl)) {
  $checks += @{ name = "Railway /health con token"; url = "$railwayUrl/health"; auth = $true; expect = 200 }
}

if (![string]::IsNullOrWhiteSpace($oracleUrl)) {
  $checks += @{ name = "Oracle /health con token"; url = "$oracleUrl/health"; auth = $true; expect = 200 }
}

$payload = @{
  token = $token
  checks = $checks
} | ConvertTo-Json -Depth 5 -Compress

$env:MAUEX_HEALTH_PAYLOAD = $payload

Title "MAUex - salud"
node -e @'
const payload = JSON.parse(process.env.MAUEX_HEALTH_PAYLOAD || '{}');
const token = payload.token || '';
const checks = payload.checks || [];

async function runCheck(check) {
  const url = check.url + (check.url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const headers = check.auth ? { Authorization: 'Bearer ' + token } : {};
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const ok = response.status === check.expect;
    const preview = response.status === 429
      ? 'Cloudflare rate limit/bloqueo temporal; esperar unos minutos y reintentar'
      : json
      ? Object.keys(json).slice(0, 8).join(', ')
      : text.slice(0, 120).replace(/\s+/g, ' ');
    console.log(`${ok ? 'OK' : 'ERROR'} ${check.name}: HTTP ${response.status} ${preview}`);
    return ok;
  } catch (error) {
    console.log(`ERROR ${check.name}: ${error.message}`);
    return false;
  }
}

(async () => {
  let allOk = true;
  for (const check of checks) {
    const ok = await runCheck(check);
    if (!ok) allOk = false;
  }
  process.exit(allOk ? 0 : 1);
})();
'@

if ($LASTEXITCODE -ne 0) {
  throw "Alguna prueba de salud fallo."
}

Write-Host ""
Write-Host "Salud OK."
