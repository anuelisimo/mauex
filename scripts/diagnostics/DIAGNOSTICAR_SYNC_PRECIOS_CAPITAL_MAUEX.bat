@echo off
chcp 65001 >nul
setlocal
title MAUex - diagnostico sync precios y capital
cd /d "%~dp0"

set "WORKER_URL=https://mauex-proxy.mauaparo.workers.dev"
if not "%~1"=="" set "WORKER_URL=%~1"

echo.
echo ============================================
echo   MAUex - diagnostico sync precios y capital
echo ============================================
echo.
echo Worker:
echo   %WORKER_URL%
echo.
echo Este diagnostico no modifica nada.
echo.

node -e "const worker=process.argv[1].replace(/\/$/,''); const urls=[worker+'/health',worker+'/summary',worker+'/balance',worker+'/balance?live=1&t=diag',worker+'/sync?t=diag','https://contract.mexc.com/api/v1/contract/ticker?symbol=XAUT_USDT','https://contract.mexc.com/api/v1/contract/ticker?symbol=BTC_USDT','https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT','https://api-futures.kucoin.com/api/v1/ticker?symbol=XBTUSDTM','https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT']; (async()=>{let rateLimited=false; for(const url of urls){console.log('\n--- '+url); try{const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),60000); const r=await fetch(url,{signal:ac.signal}); clearTimeout(timer); const text=await r.text(); console.log('STATUS',r.status,r.statusText); const ct=r.headers.get('content-type')||''; if(r.status===429){rateLimited=true; console.log('DIAG: RATE_LIMIT_429 Cloudflare esta bloqueando temporalmente este endpoint.');} if(!ct.includes('json') && url.startsWith(worker)) console.log('DIAG: El Worker devolvio HTML/no JSON.'); console.log(text.slice(0,1600)); }catch(e){console.log('ERROR',e.name,e.message); if(e.cause) console.log('CAUSE',e.cause.code||'',e.cause.message||e.cause);}} console.log('\n============================================'); console.log('Resultado rapido'); console.log('============================================'); if(rateLimited){console.log('PROBLEMA PRINCIPAL: Worker con 429 Too Many Requests. Esperar cooldown y desplegar el fix que reduce auto-sync.');} else {console.log('No vi 429 en esta corrida. Revisar errores JSON arriba y balances/exchanges vacios.');} })()" "%WORKER_URL%"

echo.
echo Si aparece 429:
echo - El Worker esta rate-limiteado por Cloudflare.
echo - Espera unos minutos para que salga del cooldown.
echo - Sube el frontend/worker actualizado para que el auto-sync no vuelva a saturarlo.
echo.
pause
