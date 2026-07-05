param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$workerName = "mauex-proxy"
$keyFile = Join-Path $root "MAUEX_API_KEYS.txt"
$exampleFile = Join-Path $root "MAUEX_API_KEYS.example.txt"
$workerConfig = Join-Path $root "wrangler.jsonc"
$backendRepo = "C:\Users\mauap\Downloads\mauex-backend-upload"

function Title($text) {
  Write-Host ""
  Write-Host "============================================"
  Write-Host "  $text"
  Write-Host "============================================"
}

function Ask-YesNo($question, $defaultYes = $true) {
  $suffix = if ($defaultYes) { "[S/n]" } else { "[s/N]" }
  $answer = Read-Host "$question $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $defaultYes }
  return $answer.Trim().ToLowerInvariant().StartsWith("s")
}

function New-Token {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function Read-KeyValue($path, $key) {
  if (!(Test-Path $path)) { return "" }
  $raw = Get-Content -LiteralPath $path -Raw
  $m = [regex]::Match($raw, "(?m)^$([regex]::Escape($key))=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

function Set-KeyValue($path, $key, $value) {
  $raw = ""
  if (Test-Path $path) {
    $raw = Get-Content -LiteralPath $path -Raw
  } elseif (Test-Path $exampleFile) {
    $raw = Get-Content -LiteralPath $exampleFile -Raw
  }

  $pattern = "(?m)^$([regex]::Escape($key))=.*$"
  if ([regex]::IsMatch($raw, $pattern)) {
    $raw = [regex]::Replace($raw, $pattern, { param($m) "$key=$value" })
  } else {
    if ($raw.Length -gt 0 -and !$raw.EndsWith("`n")) { $raw += "`r`n" }
    $raw += "$key=$value`r`n"
  }
  Set-Content -LiteralPath $path -Value $raw -Encoding UTF8
}

function Run($label, [scriptblock]$block) {
  Write-Host ""
  Write-Host "-- $label"
  if ($DryRun) {
    Write-Host "DRY RUN: omitido"
    return
  }
  & $block
}

function Run-Native($label, $file, [string[]]$CommandArgs) {
  Write-Host ""
  Write-Host "-- $label"
  if ($DryRun) {
    Write-Host "DRY RUN: omitido"
    return
  }
  & $file @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "$label fallo con codigo $LASTEXITCODE"
  }
}

function Put-WranglerSecretFromFile($secretName, $value) {
  $tmp = Join-Path $env:TEMP ("mauex_" + [guid]::NewGuid().ToString("N") + ".tmp")
  try {
    Set-Content -LiteralPath $tmp -Value $value -NoNewline -Encoding ASCII
    $cmd = 'npx.cmd --cache ".\.npm-cache" wrangler secret put ' + $secretName + ' --name ' + $workerName + ' < "' + $tmp + '"'
    cmd.exe /c $cmd
    if ($LASTEXITCODE -ne 0) {
      throw "No pude cargar el secret $secretName en Cloudflare."
    }
  } finally {
    if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }
}

function Ensure-TokenAndOrigin {
  Title "1/8 Token interno y origen permitido"

  $token = Read-KeyValue $keyFile "MAUEX_API_TOKEN"
  if ([string]::IsNullOrWhiteSpace($token)) {
    if ($DryRun) {
      $token = "dry-run-token"
      Write-Host "DRY RUN: se usaria un token nuevo."
    } else {
      $token = New-Token
      Set-KeyValue $keyFile "MAUEX_API_TOKEN" $token
      Write-Host "Token nuevo creado y guardado en MAUEX_API_KEYS.txt."
    }
  } else {
    Write-Host "Token existente encontrado en MAUEX_API_KEYS.txt."
  }

  $origin = Read-KeyValue $keyFile "ALLOWED_ORIGIN"
  if ([string]::IsNullOrWhiteSpace($origin)) { $origin = "https://mauex.vercel.app" }
  Write-Host ""
  Write-Host "Origen actual sugerido: $origin"
  $inputOrigin = Read-Host "Dominio real de MauEX en Vercel [Enter para usar ese]"
  if (![string]::IsNullOrWhiteSpace($inputOrigin)) { $origin = $inputOrigin.Trim().TrimEnd("/") }
  if (!$DryRun) { Set-KeyValue $keyFile "ALLOWED_ORIGIN" $origin }

  [pscustomobject]@{ Token = $token; Origin = $origin }
}

function Validate-Syntax {
  Title "2/8 Validacion de sintaxis"
  Run-Native "worker.js" "node" @("--check", "worker\worker.js")
  Run-Native "server.js" "node" @("--check", "server\server.js")
  Run-Native "oracle backend" "node" @("--check", "oracle\mauex-binance-backend.js")
  Run-Native "app.js" "node" @("--check", "frontend\app.js")
  Run-Native "firebase.js" "node" @("--check", "frontend\firebase.js")
}

function Configure-Cloudflare($token, $origin) {
  Title "3/8 Cloudflare Worker"
  if (!(Ask-YesNo "Configurar secrets y desplegar Worker en Cloudflare?" $true)) { return }

  Run "Verificando login de Wrangler" {
    & npx.cmd --cache ".\.npm-cache" wrangler whoami
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "Wrangler necesita login. Se abre el login de Cloudflare."
      & npx.cmd --cache ".\.npm-cache" wrangler login
      if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar sesion en Cloudflare." }
    }
  }

  Run "Cargando MAUEX_API_TOKEN en Cloudflare" {
    Put-WranglerSecretFromFile "MAUEX_API_TOKEN" $token
  }

  Run "Cargando ALLOWED_ORIGIN en Cloudflare" {
    Put-WranglerSecretFromFile "ALLOWED_ORIGIN" $origin
  }

  if (Test-Path $workerConfig) {
    Run "Desplegando Worker con bindings existentes" {
      & npx.cmd --cache ".\.npm-cache" wrangler deploy --config "wrangler.jsonc" --keep-vars
      if ($LASTEXITCODE -ne 0) { throw "Fallo el deploy por Wrangler. Podes usar COPIAR_WORKER_CLOUDFLARE.bat como fallback." }
    }
  } else {
    Write-Host "No encontre wrangler.mauex.restore.jsonc. Uso fallback manual."
    Run "Copiando Worker al portapapeles" {
      & cmd.exe /c "COPIAR_WORKER_CLOUDFLARE.bat"
      if ($LASTEXITCODE -ne 0) { throw "No pude copiar worker.js." }
    }
  }
}

function Publish-Frontend {
  Title "4/8 Frontend / Vercel"
  if (!(Ask-YesNo "Subir frontend a GitHub para que Vercel despliegue?" $true)) { return }
  Run "Subiendo frontend" {
    & cmd.exe /c 'SUBIR_CAMBIOS_FRONTEND_MAUEX.bat "Fase 0 seguridad MauEX"'
    if ($LASTEXITCODE -ne 0) { throw "No pude subir el frontend." }
  }
}

function Publish-BackendRepo {
  Title "5/8 Repo backend / Railway"
  if (!(Test-Path (Join-Path $backendRepo ".git"))) {
    Write-Host "No encontre repo backend en $backendRepo. Salto este paso."
    return
  }
  if (!(Ask-YesNo "Copiar server.js/package.json/Oracle al repo backend y subir a GitHub?" $true)) { return }

  Run "Actualizando repo backend" {
    Push-Location $backendRepo
    try {
      git pull --rebase origin main
      if ($LASTEXITCODE -ne 0) { throw "git pull fallo en repo backend" }

      Copy-Item -LiteralPath (Join-Path $root "server\server.js") -Destination (Join-Path $backendRepo "server.js") -Force
      Copy-Item -LiteralPath (Join-Path $root "server\package.json") -Destination (Join-Path $backendRepo "package.json") -Force
      Copy-Item -LiteralPath (Join-Path $root "worker\worker.js") -Destination (Join-Path $backendRepo "worker.js") -Force
      New-Item -ItemType Directory -Force -Path (Join-Path $backendRepo "oracle-binance-backend") | Out-Null
      Copy-Item -LiteralPath (Join-Path $root "oracle\mauex-binance-backend.js") -Destination (Join-Path $backendRepo "oracle-binance-backend\mauex-binance-backend.js") -Force
      Copy-Item -LiteralPath (Join-Path $root "oracle\instalar-en-oracle.sh") -Destination (Join-Path $backendRepo "oracle-binance-backend\instalar-en-oracle.sh") -Force

      git add server.js package.json worker.js oracle-binance-backend
      git diff --cached --quiet
      if ($LASTEXITCODE -ne 0) {
        git commit -m "Fase 0 security hardening"
        if ($LASTEXITCODE -ne 0) { throw "git commit fallo en repo backend" }
      } else {
        Write-Host "No hay cambios nuevos para commitear en backend."
      }
      git push origin main
      if ($LASTEXITCODE -ne 0) { throw "git push fallo en repo backend" }
    } finally {
      Pop-Location
    }
  }

  Write-Host ""
  Write-Host "IMPORTANTE: en Railway agrega estas variables si no existen:"
  Write-Host "  MAUEX_API_TOKEN = el token guardado en MAUEX_API_KEYS.txt"
  Write-Host "  ALLOWED_ORIGIN  = $($script:Origin)"
  Write-Host "El script no imprime el token. Lo va a copiar al portapapeles al final."
}

function Configure-Oracle($token, $origin) {
  Title "6/8 Oracle backend"
  if (!(Ask-YesNo "Actualizar backend Oracle y setear MAUEX_API_TOKEN en /opt/mauex-binance/.env?" $true)) { return }

  $defaultIp = "146.235.243.105"
  $ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
  if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }
  $user = "ubuntu"
  $defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
  $keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
  if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
  $keyPath = $keyPath.Trim().Trim('"')
  if (!(Test-Path $keyPath)) { throw "No encuentro private key: $keyPath" }

  $envTmp = Join-Path $env:TEMP ("mauex_oracle_env_" + [guid]::NewGuid().ToString("N") + ".env")
  try {
    Set-Content -LiteralPath $envTmp -Value "MAUEX_API_TOKEN=$token`nALLOWED_ORIGIN=$origin`n" -NoNewline -Encoding ASCII
    Run "Subiendo archivos a Oracle" {
      icacls $keyPath /inheritance:r | Out-Null
      icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null
      ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" "mkdir -p /tmp/mauex-fase0"
      if ($LASTEXITCODE -ne 0) { throw "ssh fallo" }
      scp -i $keyPath -o StrictHostKeyChecking=accept-new `
        "oracle\mauex-binance-backend.js" `
        "oracle\instalar-en-oracle.sh" `
        $envTmp `
        "${user}@${ip}:/tmp/mauex-fase0/"
      if ($LASTEXITCODE -ne 0) { throw "scp fallo" }
    }

    $remote = @'
set -e
cd /tmp/mauex-fase0
sudo bash instalar-en-oracle.sh
sudo cp /tmp/mauex-fase0/mauex-binance-backend.js /opt/mauex-binance/mauex-binance-backend.js
sudo touch /opt/mauex-binance/.env
sudo awk -F= 'NR==FNR{line[$1]=$0; seen[$1]=0; next} {if($1 in line){print line[$1]; seen[$1]=1} else print} END{for(k in line){if(!seen[k]) print line[k]}}' /tmp/mauex-fase0/*.env /opt/mauex-binance/.env | sudo tee /opt/mauex-binance/.env.tmp >/dev/null
sudo mv /opt/mauex-binance/.env.tmp /opt/mauex-binance/.env
sudo rm -f /tmp/mauex-fase0/*.env
sudo systemctl restart mauex-binance
sleep 2
sudo systemctl is-active --quiet mauex-binance
echo ORACLE_OK
'@
    $remoteOneLine = $remote -replace "`r?`n", " && "
    Run "Instalando y reiniciando Oracle" {
      ssh -i $keyPath -o StrictHostKeyChecking=accept-new "$user@$ip" $remoteOneLine
      if ($LASTEXITCODE -ne 0) { throw "Instalacion Oracle fallo" }
    }

    Run "Probando Oracle con token" {
      $base = "http://mauex-binance.$ip.nip.io:8080"
      $headers = @{ Authorization = "Bearer $token" }
      $health = Invoke-RestMethod "$base/health" -Headers $headers -TimeoutSec 30
      Write-Host ("Oracle health: " + ($health | ConvertTo-Json -Compress -Depth 10))
    }
  } finally {
    if (Test-Path $envTmp) { Remove-Item -LiteralPath $envTmp -Force }
  }
}

function Deploy-FirestoreRules {
  Title "7/8 Firestore Rules"
  if (!(Test-Path "firestore.rules")) {
    Write-Host "No encuentro firestore.rules."
    return
  }

  if (!(Ask-YesNo "Intentar deploy automatico de firestore.rules con Firebase CLI?" $false)) {
    Get-Content -LiteralPath "firestore.rules" -Raw | Set-Clipboard
    Write-Host "Copie firestore.rules al portapapeles."
    Write-Host "Pegalo en Firebase Console > Firestore Database > Rules > Publish."
    return
  }

  $projectId = Read-Host "Firebase project id"
  if ([string]::IsNullOrWhiteSpace($projectId)) {
    Write-Host "Sin project id. Copio reglas al portapapeles."
    Get-Content -LiteralPath "firestore.rules" -Raw | Set-Clipboard
    return
  }

  $cfg = Join-Path $env:TEMP ("mauex_firebase_" + [guid]::NewGuid().ToString("N") + ".json")
  try {
    Set-Content -LiteralPath $cfg -Value '{ "firestore": { "rules": "firestore.rules" } }' -Encoding ASCII
    Run "Desplegando Firestore Rules" {
      & npx.cmd --cache ".\.npm-cache" firebase-tools deploy --only firestore:rules --project $projectId --config $cfg
      if ($LASTEXITCODE -ne 0) { throw "Firebase deploy fallo" }
    }
  } finally {
    if (Test-Path $cfg) { Remove-Item -LiteralPath $cfg -Force }
  }
}

function Final-Checks($token) {
  Title "8/8 Verificacion final"
  $workerUrl = Read-KeyValue $keyFile "MAUEX_WORKER_URL"
  if ([string]::IsNullOrWhiteSpace($workerUrl)) { $workerUrl = "https://mauex-proxy.mauaparo.workers.dev" }

  Run "Probando Worker /health sin token" {
    $h = Invoke-RestMethod "$workerUrl/health?t=$(Get-Date -Format yyyyMMddHHmmss)" -TimeoutSec 30
    Write-Host ("Health: " + ($h | ConvertTo-Json -Compress -Depth 10))
  }

  Run "Probando Worker /balance sin token debe dar 401" {
    try {
      Invoke-RestMethod "$workerUrl/balance?t=$(Get-Date -Format yyyyMMddHHmmss)" -TimeoutSec 30 | Out-Null
      throw "Balance sin token NO dio 401."
    } catch {
      $status = $_.Exception.Response.StatusCode.value__
      if ($status -ne 401) { throw "Balance sin token dio status $status, esperaba 401." }
      Write-Host "OK: /balance sin token = 401"
    }
  }

  Run "Probando Worker /balance con token" {
    $headers = @{ Authorization = "Bearer $token" }
    $b = Invoke-RestMethod "$workerUrl/balance?t=$(Get-Date -Format yyyyMMddHHmmss)" -Headers $headers -TimeoutSec 30
    Write-Host ("Balance OK. Campos: " + (($b.PSObject.Properties.Name) -join ", "))
  }

  if (!$DryRun) {
    Set-Clipboard -Value $token
    Write-Host ""
    Write-Host "Token copiado al portapapeles para pegarlo en Settings de MauEX y/o Railway."
  }
}

Title "MAUex - activar seguridad Fase 0"
if ($DryRun) {
  Write-Host "Modo prueba activo: no toca servicios externos."
}

$config = Ensure-TokenAndOrigin
$script:Origin = $config.Origin
Validate-Syntax
Configure-Cloudflare $config.Token $config.Origin
Publish-Frontend
Publish-BackendRepo
Configure-Oracle $config.Token $config.Origin
Deploy-FirestoreRules
Final-Checks $config.Token

Title "Listo"
Write-Host "Fase 0 aplicada o guiada hasta donde los logins externos lo permitieron."
Write-Host "Abri MauEX, Settings, pega el token en MAUEX_API_TOKEN, guarda y recarga."
