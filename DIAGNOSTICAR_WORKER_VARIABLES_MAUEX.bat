@echo off
chcp 65001 >nul
setlocal
title MAUex - diagnostico variables Worker
cd /d "%~dp0"

set "WORKER_URL=https://mauex-proxy.mauaparo.workers.dev"
if not "%~1"=="" set "WORKER_URL=%~1"

echo.
echo ============================================
echo   MAUex - diagnostico variables Worker
echo ============================================
echo.
echo Worker:
echo   %WORKER_URL%
echo.
echo No muestra secretos. Solo dice true/false y totales.
echo.

node -e "const worker=process.argv[1].replace(/\/$/,''); async function read(path){const r=await fetch(worker+path); const text=await r.text(); let j=null; try{j=JSON.parse(text)}catch{} return {status:r.status, type:r.headers.get('content-type')||'', json:j, text};} (async()=>{for(const path of ['/health','/summary','/balance']){console.log('\n--- '+path); try{const res=await read(path); console.log('STATUS',res.status); if(!res.json){console.log('NO JSON:',res.text.slice(0,500)); continue;} if(path==='/health'){console.log('version:',res.json.version); console.log('hasKV:',res.json.hasKV); console.log('keys:',JSON.stringify(res.json.keys,null,2)); const k=res.json.keys||{}; const missing=[]; if(!k.binanceBackend&&!k.railway) missing.push('BINANCE_BACKEND_URL o RAILWAY_URL'); if(!k.kucoinBackend) missing.push('KUCOIN_BACKEND_URL o BINANCE_BACKEND_URL'); if(!k.ibkrBackend) missing.push('IBKR_BACKEND_URL o BINANCE_BACKEND_URL'); if(!k.bybit) missing.push('BYBIT_KEY / BYBIT_SECRET'); if(!k.okx) missing.push('OKX_KEY / OKX_SECRET / OKX_PASSPHRASE'); if(!k.mexc) missing.push('MEXC_KEY / MEXC_SECRET'); if(!res.json.hasKV) missing.push('binding KV MAUEX_CACHE'); console.log('faltantes_probables:',missing.length?missing.join(', '):'ninguno');} else {console.log('lastSync:',res.json.lastSync||null); console.log('totals:',JSON.stringify(res.json.totals||res.json.liquidity||null)); console.log('balances:',JSON.stringify(res.json.balances?Object.keys(res.json.balances):[])); console.log('errors:',JSON.stringify(res.json.errors||res.json.balanceErrors||{}));}}catch(e){console.log('ERROR',e.message)}} })()" "%WORKER_URL%"

echo.
pause
