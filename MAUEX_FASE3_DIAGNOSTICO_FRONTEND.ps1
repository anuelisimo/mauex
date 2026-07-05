$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$failures = New-Object System.Collections.Generic.List[string]

function Check($name, [bool]$ok, $detail = "") {
  $status = if ($ok) { "OK" } else { "ERROR" }
  $line = if ($detail) { "$status - ${name}: $detail" } else { "$status - $name" }
  Write-Host $line
  if (-not $ok) { $failures.Add($name) | Out-Null }
}

Write-Host "MAUex - diagnostico frontend Fase 3"
Write-Host ("Fecha: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ""

Check "frontend/package.json" (Test-Path "frontend\package.json")
Check "frontend/vite.config.js" (Test-Path "frontend\vite.config.js")
Check "frontend/proxy.js" (Test-Path "frontend\proxy.js")
Check "frontend/src/README.md" (Test-Path "frontend\src\README.md")
Check "plan Fase 3" (Test-Path "MAUEX_FASE3_FRONTEND_PLAN.md")

Write-Host ""
Write-Host "Sintaxis"
& npm.cmd run check
Check "npm run check raiz" ($LASTEXITCODE -eq 0)

Write-Host ""
Write-Host "Frontend package"
try {
  $pkg = Get-Content -LiteralPath "frontend\package.json" -Raw | ConvertFrom-Json
  Check "script dev Vite" ([bool]$pkg.scripts.dev)
  Check "script build Vite" ([bool]$pkg.scripts.build)
  Check "dependencia firebase npm" ([bool]$pkg.dependencies.firebase)
  Check "devDependency vite" ([bool]$pkg.devDependencies.vite)
} catch {
  Check "parse frontend/package.json" $false $_.Exception.Message
}

Write-Host ""
Write-Host "HTML actual"
$html = Get-Content -LiteralPath "frontend\index.html" -Raw
Check "carga firebase.js" ($html -match 'firebase\.js')
Check "carga proxy.js antes de app.js" ($html.IndexOf('proxy.js') -ge 0 -and $html.IndexOf('proxy.js') -lt $html.IndexOf('app.js'))
Check "carga app.js" ($html -match 'app\.js')
Check "mantiene HTML actual" ($html -match '<div id="app"')

Write-Host ""
Write-Host "Mapa de split"
$app = Get-Content -LiteralPath "frontend\app.js" -Raw
$proxy = Get-Content -LiteralPath "frontend\proxy.js" -Raw
Check "proxy.js contiene workerFetch" ($proxy.Contains('window.workerFetch'))
Check "app.js sin workerFetch propio" (-not $app.Contains('window.workerFetch = function workerFetch'))
foreach ($marker in @("Proxy config","Helpers","Navigation","Themes","Calc state","Dashboard","EXCHANGE INTEGRATION","Init")) {
  Check "seccion $marker" ($app.Contains($marker))
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "Resultado: OK. Fase 3 preparada para migracion gradual."
  exit 0
}

Write-Host ("Resultado: revisar " + $failures.Count + " punto(s).")
exit 1
