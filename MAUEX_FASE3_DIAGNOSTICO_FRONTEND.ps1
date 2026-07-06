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
Check "frontend/helpers.js" (Test-Path "frontend\helpers.js")
Check "frontend/nav.js" (Test-Path "frontend\nav.js")
Check "frontend/themes.js" (Test-Path "frontend\themes.js")
Check "frontend/signals.js" (Test-Path "frontend\signals.js")
Check "frontend/calc.js" (Test-Path "frontend\calc.js")
Check "frontend/dashboard.js" (Test-Path "frontend\dashboard.js")
Check "frontend/watchlist.js" (Test-Path "frontend\watchlist.js")
Check "frontend/positions.js" (Test-Path "frontend\positions.js")
Check "frontend/history.js" (Test-Path "frontend\history.js")
Check "frontend/analysis.js" (Test-Path "frontend\analysis.js")
Check "frontend/exchange-keys.js" (Test-Path "frontend\exchange-keys.js")
Check "frontend/orders.js" (Test-Path "frontend\orders.js")
Check "frontend/init.js" (Test-Path "frontend\init.js")
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
Check "carga helpers.js entre proxy y app" ($html.IndexOf('proxy.js') -ge 0 -and $html.IndexOf('helpers.js') -gt $html.IndexOf('proxy.js') -and $html.IndexOf('helpers.js') -lt $html.IndexOf('app.js'))
Check "carga nav.js entre helpers y app" ($html.IndexOf('helpers.js') -ge 0 -and $html.IndexOf('nav.js') -gt $html.IndexOf('helpers.js') -and $html.IndexOf('nav.js') -lt $html.IndexOf('app.js'))
Check "carga themes.js entre nav y app" ($html.IndexOf('nav.js') -ge 0 -and $html.IndexOf('themes.js') -gt $html.IndexOf('nav.js') -and $html.IndexOf('themes.js') -lt $html.IndexOf('app.js'))
Check "carga signals.js entre themes y app" ($html.IndexOf('themes.js') -ge 0 -and $html.IndexOf('signals.js') -gt $html.IndexOf('themes.js') -and $html.IndexOf('signals.js') -lt $html.IndexOf('app.js'))
Check "carga calc.js entre signals y app" ($html.IndexOf('signals.js') -ge 0 -and $html.IndexOf('calc.js') -gt $html.IndexOf('signals.js') -and $html.IndexOf('calc.js') -lt $html.IndexOf('app.js'))
Check "carga dashboard.js antes de app" ($html.IndexOf('dashboard.js') -ge 0 -and $html.IndexOf('dashboard.js') -lt $html.IndexOf('app.js'))
Check "carga watchlist.js antes de app" ($html.IndexOf('watchlist.js') -ge 0 -and $html.IndexOf('watchlist.js') -lt $html.IndexOf('app.js'))
Check "carga positions.js antes de app" ($html.IndexOf('positions.js') -ge 0 -and $html.IndexOf('positions.js') -lt $html.IndexOf('app.js'))
Check "carga history.js antes de app" ($html.IndexOf('history.js') -ge 0 -and $html.IndexOf('history.js') -lt $html.IndexOf('app.js'))
Check "carga analysis.js antes de app" ($html.IndexOf('analysis.js') -ge 0 -and $html.IndexOf('analysis.js') -lt $html.IndexOf('app.js'))
Check "carga exchange-keys.js antes de app" ($html.IndexOf('exchange-keys.js') -ge 0 -and $html.IndexOf('exchange-keys.js') -lt $html.IndexOf('app.js'))
Check "carga orders.js antes de app" ($html.IndexOf('orders.js') -ge 0 -and $html.IndexOf('orders.js') -lt $html.IndexOf('app.js'))
Check "carga init.js antes de app" ($html.IndexOf('init.js') -ge 0 -and $html.IndexOf('init.js') -lt $html.IndexOf('app.js'))
Check "carga app.js" ($html -match 'app\.js')
Check "mantiene HTML actual" ($html -match '<div id="app"')

Write-Host ""
Write-Host "Mapa de split"
$app = Get-Content -LiteralPath "frontend\app.js" -Raw
if ($null -eq $app) { $app = "" }
$proxy = Get-Content -LiteralPath "frontend\proxy.js" -Raw
$helpers = Get-Content -LiteralPath "frontend\helpers.js" -Raw
$nav = Get-Content -LiteralPath "frontend\nav.js" -Raw
$themes = Get-Content -LiteralPath "frontend\themes.js" -Raw
$signals = Get-Content -LiteralPath "frontend\signals.js" -Raw
$calc = Get-Content -LiteralPath "frontend\calc.js" -Raw
$dashboard = Get-Content -LiteralPath "frontend\dashboard.js" -Raw
$watchlist = Get-Content -LiteralPath "frontend\watchlist.js" -Raw
$positions = Get-Content -LiteralPath "frontend\positions.js" -Raw
$history = Get-Content -LiteralPath "frontend\history.js" -Raw
$analysis = Get-Content -LiteralPath "frontend\analysis.js" -Raw
$exchangeKeys = Get-Content -LiteralPath "frontend\exchange-keys.js" -Raw
$orders = Get-Content -LiteralPath "frontend\orders.js" -Raw
$init = Get-Content -LiteralPath "frontend\init.js" -Raw
Check "proxy.js contiene workerFetch" ($proxy.Contains('window.workerFetch'))
Check "app.js sin workerFetch propio" (-not $app.Contains('window.workerFetch = function workerFetch'))
Check "helpers.js contiene toast" ($helpers.Contains('window.toast'))
Check "helpers.js contiene modales" ($helpers.Contains('window.openModal') -and $helpers.Contains('showOrderExecutedModal'))
Check "app.js sin helpers iniciales" (-not $app.Contains('window.toast ='))
Check "nav.js contiene showPage" ($nav.Contains('window.showPage'))
Check "nav.js contiene estado operativo" ($nav.Contains('window.renderOperationalStatus'))
Check "app.js sin Navigation" (-not $app.Contains('Navigation'))
Check "themes.js contiene applyTheme" ($themes.Contains('window.applyTheme'))
Check "themes.js contiene openThemePicker" ($themes.Contains('window.openThemePicker'))
Check "app.js sin THEMES" (-not $app.Contains('const THEMES'))
Check "signals.js contiene renderSignals" ($signals.Contains('function renderSignals'))
Check "signals.js contiene Telegram secret key" ($signals.Contains('SIGNAL_TELEGRAM_SECRET_KEY'))
Check "app.js sin Signal Desk" (-not $app.Contains('Signal Desk'))
Check "calc.js contiene calcState" ($calc.Contains('const calcState'))
Check "calc.js contiene compute" ($calc.Contains('window.compute'))
Check "app.js sin Calc state" (-not $app.Contains('Calc state'))
Check "dashboard.js contiene renderDashboard" ($dashboard.Contains('function renderDashboard'))
Check "watchlist.js contiene renderWatchlist" ($watchlist.Contains('function renderWatchlist'))
Check "positions.js contiene renderPositions" ($positions.Contains('function renderPositions'))
Check "history.js contiene renderHistory" ($history.Contains('function renderHistory'))
Check "analysis.js contiene loadCharts" ($analysis.Contains('window.loadCharts'))
Check "exchange-keys.js contiene encryptData" ($exchangeKeys.Contains('function encryptData'))
Check "orders.js contiene renderOrders" ($orders.Contains('function renderOrders'))
Check "init.js contiene buildLevGrid" ($init.Contains('buildLevGrid'))
Check "app.js sin renderDashboard" (-not $app.Contains('function renderDashboard'))
Check "app.js sin renderWatchlist" (-not $app.Contains('function renderWatchlist'))
Check "app.js sin renderPositions" (-not $app.Contains('function renderPositions'))
Check "app.js sin renderHistory" (-not $app.Contains('function renderHistory'))
Check "app.js sin loadCharts" (-not $app.Contains('window.loadCharts'))
Check "app.js sin exchange integration" (-not $app.Contains('EXCHANGE INTEGRATION'))
Check "app.js sin renderOrders" (-not $app.Contains('function renderOrders'))
Check "app.js vacio o shell minimo" ($app.Trim().Length -le 100)

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "Resultado: OK. Fase 3 preparada para migracion gradual."
  exit 0
}

Write-Host ("Resultado: revisar " + $failures.Count + " punto(s).")
exit 1
