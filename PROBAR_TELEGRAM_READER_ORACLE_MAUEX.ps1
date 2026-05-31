$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$keyPath = Read-Host "Arrastra aca la private key de Oracle y presiona Enter"
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

ssh -i $keyPath -o StrictHostKeyChecking=accept-new "ubuntu@$ip" "echo '---- Servicio ----'; systemctl status mauex-telegram-reader --no-pager -l | head -n 30; echo; echo '---- Ultimos logs ----'; journalctl -u mauex-telegram-reader -n 80 --no-pager"
