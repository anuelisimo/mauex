$ErrorActionPreference = "Stop"

function Read-KeyValue($path, $key) {
  if (!(Test-Path $path)) { return "" }
  $raw = Get-Content -LiteralPath $path -Raw
  $m = [regex]::Match($raw, "(?m)^" + [regex]::Escape($key) + "=(.+)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

function Require-File($path) {
  if (!(Test-Path $path)) { throw "No encuentro archivo: $path" }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyFile = Join-Path $root "MAUEX_API_KEYS.txt"
$token = Read-KeyValue $keyFile "MAUEX_API_TOKEN"
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = Read-Host "Pega MAUEX_API_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($token)) { throw "Falta MAUEX_API_TOKEN" }

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
$keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
$keyPath = $keyPath.Trim().Trim('"')
Require-File $keyPath

$readerDir = Join-Path $root "oracle\telegram-reader"
$readerFile = Join-Path $readerDir "mauex-telegram-reader.js"
$packageFile = Join-Path $readerDir "package.json"
Require-File $readerFile
Require-File $packageFile

Write-Host ""
Write-Host "Ajustando permisos de la private key..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

$knownHosts = Join-Path $env:TEMP "mauex_oracle_known_hosts"
if (!(Test-Path $knownHosts)) {
  Set-Content -LiteralPath $knownHosts -Value "" -Encoding ascii
}
$sshOpts = @(
  "-i", $keyPath,
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "UserKnownHostsFile=$knownHosts"
)

$user = "ubuntu"
Write-Host ""
Write-Host "Subiendo reader actualizado a Oracle..."
ssh @sshOpts "$user@$ip" "mkdir -p /tmp/mauex-telegram"
if ($LASTEXITCODE -ne 0) { throw "ssh fallo creando /tmp/mauex-telegram" }

scp @sshOpts $readerFile $packageFile "${user}@${ip}:/tmp/mauex-telegram/"
if ($LASTEXITCODE -ne 0) { throw "scp fallo subiendo reader" }

$envLine = "MAUEX_API_TOKEN=$token`n"
$envLineB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($envLine))

$remoteScript = @"
set -e
sudo mkdir -p /opt/mauex-telegram
sudo cp /tmp/mauex-telegram/mauex-telegram-reader.js /opt/mauex-telegram/mauex-telegram-reader.js
sudo cp /tmp/mauex-telegram/package.json /opt/mauex-telegram/package.json
sudo chown -R ubuntu:ubuntu /opt/mauex-telegram
cd /opt/mauex-telegram
npm install --omit=dev
sudo touch /opt/mauex-telegram/.env
sudo chown ubuntu:ubuntu /opt/mauex-telegram/.env
sudo chmod 600 /opt/mauex-telegram/.env
tmp_env=`$(mktemp)
grep -v '^MAUEX_API_TOKEN=' /opt/mauex-telegram/.env > "`$tmp_env" || true
echo '$envLineB64' | base64 -d >> "`$tmp_env"
sudo cp "`$tmp_env" /opt/mauex-telegram/.env
rm -f "`$tmp_env"
sudo chown ubuntu:ubuntu /opt/mauex-telegram/.env
sudo chmod 600 /opt/mauex-telegram/.env
sudo systemctl restart mauex-telegram-reader
sleep 5
echo '---- Token en .env ----'
sudo grep '^MAUEX_API_TOKEN=' /opt/mauex-telegram/.env | sed 's/=.*/=***guardado***/'
echo
echo '---- Servicio ----'
systemctl status mauex-telegram-reader --no-pager -l | head -n 30 || true
echo
echo '---- Ultimos logs ----'
sudo journalctl -u mauex-telegram-reader -n 80 || true
"@

$remoteScriptPath = Join-Path $env:TEMP ("mauex_heartbeat_remote_" + [guid]::NewGuid().ToString("N") + ".sh")
[System.IO.File]::WriteAllText($remoteScriptPath, ($remoteScript -replace "`r`n", "`n"), [System.Text.Encoding]::ASCII)
scp @sshOpts $remoteScriptPath "${user}@${ip}:/tmp/mauex-telegram/config-heartbeat.sh"
Remove-Item -LiteralPath $remoteScriptPath -Force
if ($LASTEXITCODE -ne 0) { throw "scp fallo subiendo script remoto" }

Write-Host ""
Write-Host "Configurando MAUEX_API_TOKEN, reiniciando servicio y revisando estado..."
ssh @sshOpts "$user@$ip" "bash /tmp/mauex-telegram/config-heartbeat.sh"
if ($LASTEXITCODE -ne 0) { throw "ssh fallo configurando heartbeat" }

Write-Host ""
Write-Host "OK. El Telegram reader ya tiene MAUEX_API_TOKEN y el codigo de heartbeat."
