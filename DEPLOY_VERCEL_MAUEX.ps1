$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

function Write-Utf8NoBomFile($Path, $Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host ""
Write-Host "Validando MAUex antes de deployar..." -ForegroundColor Cyan
& npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw "npm run check fallo" }

Write-Host ""
Write-Host "Construyendo frontend para Vercel..." -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "npm run build fallo" }

$projectLink = Join-Path $PSScriptRoot '.vercel\project.json'
if (-not (Test-Path -LiteralPath $projectLink)) {
  Write-Host ""
  Write-Host "Esta carpeta todavia no esta linkeada a Vercel." -ForegroundColor Yellow
  Write-Host "Si Vercel pregunta, elegi el proyecto existente de MAUex, no crear uno nuevo." -ForegroundColor Yellow
  Write-Host ""
  & npx.cmd vercel link --yes
  if ($LASTEXITCODE -ne 0) { throw "vercel link fallo" }
}

$deployDir = Join-Path $PSScriptRoot '.mauex-vercel-deploy'
$resolvedRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
if (Test-Path -LiteralPath $deployDir) {
  $resolvedDeploy = (Resolve-Path -LiteralPath $deployDir).Path
  if (-not $resolvedDeploy.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Ruta de deploy insegura: $resolvedDeploy"
  }
  Remove-Item -LiteralPath $deployDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDir | Out-Null
$deployPublic = Join-Path $deployDir 'public'
New-Item -ItemType Directory -Path $deployPublic | Out-Null
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'public') -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $deployPublic -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.vercel') -Destination (Join-Path $deployDir '.vercel') -Recurse -Force

$deployedIndex = Join-Path $deployPublic 'index.html'
$deployedFiles = @(Get-ChildItem -LiteralPath $deployPublic -Recurse -File -Force)
if (-not (Test-Path -LiteralPath $deployedIndex) -or $deployedFiles.Count -eq 0) {
  throw "La carpeta temporal de Vercel quedo vacia. No deployo para evitar otra falla."
}
Write-Host ("Frontend listo para Vercel: " + $deployedFiles.Count + " archivos copiados.") -ForegroundColor Green

Write-Utf8NoBomFile (Join-Path $deployDir 'package.json') @'
{
  "name": "mauex-static-deploy",
  "private": true,
  "scripts": {
    "build": "node -e \"console.log('MAUex static deploy ready')\""
  }
}
'@

Write-Utf8NoBomFile (Join-Path $deployDir 'vercel.json') @'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "",
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "rewrites": [
    {
      "source": "/",
      "destination": "/index.html"
    }
  ]
}
'@

Write-Host ""
Write-Host "Deployando a produccion en Vercel..." -ForegroundColor Cyan
Write-Host "Si aparece login de Vercel, inicia sesion y volve a confirmar el deploy." -ForegroundColor Yellow

& npx.cmd vercel deploy $deployDir --prod --yes --force
if ($LASTEXITCODE -ne 0) { throw "vercel deploy fallo" }

Write-Host ""
Write-Host "Listo. Vercel deberia mostrar la URL de produccion arriba." -ForegroundColor Green
Write-Host "Abri MAUex con Ctrl+F5 para evitar cache viejo." -ForegroundColor Green
