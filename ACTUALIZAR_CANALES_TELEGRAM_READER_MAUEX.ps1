$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$keyPath = Read-Host "Arrastra aca la private key de Oracle y presiona Enter"
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

$channels = "BinanceKillersVipOfficial,BitcoinBullets_VipOfficial"

Write-Host ""
Write-Host "Actualizando canales oficiales y reiniciando lector..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "ubuntu@$ip" "sudo sed -i '/^MAUEX_TELEGRAM_CHANNELS=/d' /opt/mauex-telegram/.env && echo 'MAUEX_TELEGRAM_CHANNELS=$channels' | sudo tee -a /opt/mauex-telegram/.env >/dev/null && sudo systemctl restart mauex-telegram-reader && sleep 4 && systemctl status mauex-telegram-reader --no-pager -l | head -n 30 && echo && echo '---- Ultimos logs ----' && journalctl -u mauex-telegram-reader -n 40 --no-pager"

Write-Host ""
Write-Host "Listo. El lector quedo limitado a BinanceKillersVipOfficial y BitcoinBullets_VipOfficial."
