$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
if (!(Test-Path (Join-Path $frontendDir "index.html"))) {
  throw "No encuentro frontend\index.html"
}
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$python = if ($pythonCmd) { $pythonCmd.Source } else { $null }

if (!$python) {
  Write-Host "No encontre Python en esta PC."
  Read-Host "Presiona Enter para cerrar"
  exit 1
}

function Test-PortFree {
  param([int]$Port)
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

$port = 4177
while (-not (Test-PortFree $port)) {
  $port++
  if ($port -gt 4190) {
    throw "No encontre un puerto libre entre 4177 y 4190."
  }
}

$url = "http://localhost:$port/index.html"

Write-Host ""
Write-Host "MAUex local"
Write-Host "Carpeta: $frontendDir"
Write-Host "URL: $url"
Write-Host ""
Write-Host "Deja esta ventana abierta mientras uses la app local."
Write-Host "Para cerrar el servidor, volve aca y presiona Enter."
Write-Host ""

$server = Start-Process -FilePath $python -ArgumentList @("-m", "http.server", "$port", "--bind", "127.0.0.1", "-d", $frontendDir) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  $test = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10
  if ($test.StatusCode -ne 200) {
    throw "La app respondio con estado $($test.StatusCode)."
  }
  Start-Process $url
  Read-Host "Presiona Enter para cerrar el servidor local"
} catch {
  Write-Host "No pude abrir la app local:"
  Write-Host $_.Exception.Message
  Write-Host ""
  Write-Host "Proba abrir manualmente:"
  Write-Host $url
  Read-Host "Presiona Enter para cerrar"
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
