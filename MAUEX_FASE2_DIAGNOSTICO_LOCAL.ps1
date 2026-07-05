$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$reportPath = Join-Path $root "MAUEX_FASE2_DIAGNOSTICO_LOCAL.txt"
$lines = New-Object System.Collections.Generic.List[string]
$failures = New-Object System.Collections.Generic.List[string]

function Add-Line($text = "") {
  $lines.Add($text) | Out-Null
  Write-Host $text
}

function Add-Check($name, [bool]$ok, $detail = "") {
  $status = if ($ok) { "OK" } else { "ERROR" }
  $line = if ([string]::IsNullOrWhiteSpace($detail)) { "$status - $name" } else { "$status - ${name}: $detail" }
  Add-Line $line
  if (-not $ok) { $failures.Add($name) | Out-Null }
}

function Run-Native($name, [string]$file, [string[]]$arguments) {
  $output = & $file @arguments 2>&1
  $ok = $LASTEXITCODE -eq 0
  Add-Check $name $ok
  if (-not $ok) {
    $preview = ($output | Select-Object -First 8) -join " "
    if ($preview) { Add-Line "  $preview" }
  }
}

Add-Line "MAUex - diagnostico local Fase 2"
Add-Line ("Fecha: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Add-Line ""

Add-Line "Estructura"
foreach ($path in @(
  "frontend\index.html",
  "frontend\styles.css",
  "frontend\firebase.js",
  "frontend\app.js",
  "worker\worker.js",
  "server\server.js",
  "server\package.json",
  "oracle\mauex-binance-backend.js",
  "firestore.rules",
  "wrangler.jsonc",
  "vercel.json",
  "firebase.json"
)) {
  Add-Check $path (Test-Path -LiteralPath (Join-Path $root $path))
}

Add-Line ""
Add-Line "Sintaxis"
Run-Native "JavaScript principal" "npm.cmd" @("run", "check")

Add-Line ""
Add-Line "Configs"
foreach ($jsonFile in @("package.json","server\package.json","vercel.json","firebase.json","wrangler.jsonc","wrangler.mauex.restore.jsonc")) {
  try {
    $full = Join-Path $root $jsonFile
    if (!(Test-Path -LiteralPath $full)) { throw "No existe" }
    $null = Get-Content -LiteralPath $full -Raw | ConvertFrom-Json
    Add-Check $jsonFile $true
  } catch {
    Add-Check $jsonFile $false $_.Exception.Message
  }
}

Add-Line ""
Add-Line "Scripts"
$rootBat = @(Get-ChildItem -LiteralPath $root -File -Filter "*.bat")
Add-Check "BAT oficiales en raiz" ($rootBat.Count -le 8) ($rootBat.Count.ToString() + " encontrados")
Add-Line ("  " + (($rootBat | Sort-Object Name | ForEach-Object { $_.Name }) -join ", "))

$scriptBat = @(Get-ChildItem -LiteralPath (Join-Path $root "scripts") -Recurse -File -Filter "*.bat")
Add-Line ("BAT archivados/ordenados en scripts/: " + $scriptBat.Count)

Add-Line ""
Add-Line "Git"
$gitStatus = git status --short 2>&1
if ($LASTEXITCODE -eq 0) {
  $statusCount = @($gitStatus).Count
  Add-Line ("Cambios visibles para Git: " + $statusCount)
  foreach ($line in (@($gitStatus) | Select-Object -First 25)) { Add-Line ("  " + $line) }
  if ($statusCount -gt 25) { Add-Line "  ...hay mas cambios" }
} else {
  Add-Check "git status" $false (($gitStatus | Select-Object -First 5) -join " ")
}

Add-Line ""
if ($failures.Count -eq 0) {
  Add-Line "Resultado: OK local. Lo que quede por validar online depende de Cloudflare/Vercel/Railway."
} else {
  Add-Line ("Resultado: revisar " + $failures.Count + " punto(s).")
}

$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
Add-Line ""
Add-Line ("Reporte guardado en: " + $reportPath)

if ($failures.Count -gt 0) { exit 1 }
exit 0
