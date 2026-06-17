$ErrorActionPreference = "Stop"

$defaultIp = "146.235.243.105"
$ip = Read-Host "IP publica de Oracle [Enter = $defaultIp]"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }

$defaultKey = "C:\Users\mauap\.ssh\mauex_oracle"
$keyPath = Read-Host "Private key de Oracle [Enter = $defaultKey]"
if ([string]::IsNullOrWhiteSpace($keyPath)) { $keyPath = $defaultKey }
$keyPath = $keyPath.Trim().Trim('"')
if (!(Test-Path $keyPath)) { throw "No encuentro la private key en: $keyPath" }

icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host ""
Write-Host "Reiniciando lector en Oracle..."
ssh -i $keyPath -o StrictHostKeyChecking=accept-new "ubuntu@$ip" "sudo systemctl restart mauex-telegram-reader && sleep 5 && echo '---- Servicio ----' && systemctl status mauex-telegram-reader --no-pager -l | head -n 25 && echo && echo '---- Ultimos logs ----' && journalctl -u mauex-telegram-reader -n 80 --no-pager"


