$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$keyPath = Read-Host "Arrastra aca la private key de Oracle y presiona Enter"
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
Write-Host "Apagando backfill y reiniciando lector..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "ubuntu@$ip" "sudo sed -i '/^MAUEX_TELEGRAM_BACKFILL=/d' /opt/mauex-telegram/.env && echo 'MAUEX_TELEGRAM_BACKFILL=0' | sudo tee -a /opt/mauex-telegram/.env >/dev/null && sudo systemctl restart mauex-telegram-reader && sleep 3 && systemctl status mauex-telegram-reader --no-pager -l | head -n 25"

Write-Host ""
Write-Host "Listo. El lector ya no reenvia senales viejas; solo nuevas."
