$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$keyPath = Read-Host "Arrastra aca la private key de Oracle y presiona Enter"
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$readerFile = Join-Path $root "telegram-reader\mauex-telegram-reader.js"
if (!(Test-Path $readerFile)) { throw "No encuentro el lector local en: $readerFile" }

$channels = "BinanceKillersVipOfficial,BitcoinBullets_VipOfficial"

Write-Host ""
Write-Host "Ajustando permisos de la private key..."
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
Write-Host "Subiendo lector corregido a Oracle..."
scp -i $keyPath -o StrictHostKeyChecking=accept-new $readerFile "ubuntu@${ip}:/tmp/mauex-telegram-reader.js"

Write-Host ""
Write-Host "Actualizando canales oficiales, logica de lectura y reiniciando lector..."
$remote = @"
set -e
sudo cp /tmp/mauex-telegram-reader.js /opt/mauex-telegram/mauex-telegram-reader.js
sudo chown ubuntu:ubuntu /opt/mauex-telegram/mauex-telegram-reader.js
sudo sed -i '/^MAUEX_TELEGRAM_CHANNELS=/d' /opt/mauex-telegram/.env
echo 'MAUEX_TELEGRAM_CHANNELS=$channels' | sudo tee -a /opt/mauex-telegram/.env >/dev/null
sudo systemctl restart mauex-telegram-reader
sleep 4
systemctl status mauex-telegram-reader --no-pager -l | head -n 30
echo
echo '---- Ultimos logs ----'
journalctl -u mauex-telegram-reader -n 60 --no-pager
"@
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "ubuntu@$ip" $remote

Write-Host ""
Write-Host "Listo. El lector quedo limitado a BinanceKillersVipOfficial y BitcoinBullets_VipOfficial."
Write-Host "Tambien quedo corregido para enviar updates de Signal ID / TP / profit / breakeven, no solo senales completas."
