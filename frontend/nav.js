// ── Navigation ─────────────────────────────────────────────────────────────
const PAGES = {
  dashboard:'dashPage', calc:'calcPage', watchlist:'watchPage',
  signals:'signalsPage', orders:'ordersPage', positions:'posPage', map:'mapPage', history:'histPage',
  traders:'tradPage', analysis:'analysisPage', settings:'settingsPage',
};

window.showDashTab = (tab) => {
  const isResumen = tab === 'resumen';
  document.getElementById('dashTabResumenContent').style.display = isResumen ? 'block' : 'none';
  document.getElementById('dashTabHistorialContent').style.display = isResumen ? 'none' : 'block';
  document.getElementById('dashTabResumen').style.cssText = isResumen
    ? 'flex:1;padding:7px 12px;border:none;border-radius:6px;font-family:var(--mono);font-size:12px;cursor:pointer;background:var(--accent);color:#000;font-weight:600;'
    : 'flex:1;padding:7px 12px;border:none;border-radius:6px;font-family:var(--mono);font-size:12px;cursor:pointer;background:none;color:var(--t2);';
  document.getElementById('dashTabHistorial').style.cssText = isResumen
    ? 'flex:1;padding:7px 12px;border:none;border-radius:6px;font-family:var(--mono);font-size:12px;cursor:pointer;background:none;color:var(--t2);'
    : 'flex:1;padding:7px 12px;border:none;border-radius:6px;font-family:var(--mono);font-size:12px;cursor:pointer;background:var(--accent);color:#000;font-weight:600;';
  if (!isResumen) {
    window.renderHistFiltersAndTable('dashHistFilters', 'dashHistTable');
  }
};

window.syncApiModalStatus = () => {
  // Sync status badges in settings page
  ['binance','bybit','okx','mexc','kucoin'].forEach(ex => {
    const el = document.getElementById(`${ex === 'binance' ? 'bnb' : ex}StatusBadge`);
    const src = document.getElementById(`${ex === 'binance' ? 'bnb' : ex}Status2`);
    if (el && src) {
      const txt = src.textContent || '';
      el.textContent = `${ex.charAt(0).toUpperCase()+ex.slice(1)} ${txt.includes('✅') ? '✅' : txt.includes('❌') ? '❌' : '—'}`;
      el.style.color = txt.includes('✅') ? 'var(--accent)' : txt.includes('❌') ? 'var(--red)' : 'var(--t3)';
    }
  });
  const row = document.getElementById('kucoinStatusBadge')?.parentElement;
  if (row && !document.getElementById('ibkrStatusBadge')) {
    const ib = document.createElement('span');
    ib.id = 'ibkrStatusBadge';
    ib.style.cssText = 'font-size:10px;font-family:var(--mono);padding:2px 8px;border-radius:4px;background:var(--bg3);color:var(--t3);';
    ib.textContent = 'IBKR Oracle -';
    row.appendChild(ib);
  }
  const ibkr = document.getElementById('ibkrStatusBadge');
  if (ibkr) {
    const hasIbkr = !!window._liquidityCache?.balances?.IBKR;
    const ibkrErr = window._liquidityCache?.errors?.IBKR || window._liquidityCache?.balanceErrors?.IBKR;
    ibkr.textContent = hasIbkr ? 'IBKR Oracle ok' : ibkrErr ? 'IBKR Oracle error' : 'IBKR Oracle -';
    ibkr.style.color = hasIbkr ? 'var(--accent)' : ibkrErr ? 'var(--red)' : 'var(--t3)';
    ibkr.title = 'IBKR se configura en Oracle con Client Portal Gateway, no con API Key dentro de MAUex.';
  }
};

function operationalStatusEscape(value) {
  return esc(value);
}

function operationalStatusItem(title, state, detail) {
  return `
    <div class="ops-status-item ${operationalStatusEscape(state)}">
      <div class="ops-status-top">
        <span class="ops-dot"></span>
        <span class="ops-status-title">${operationalStatusEscape(title)}</span>
      </div>
      <div class="ops-status-detail">${operationalStatusEscape(detail)}</div>
    </div>`;
}

window.renderOperationalStatus = () => {
  const grid = document.getElementById('operationalStatusGrid');
  if (!grid) return;
  const user = window._getCU?.();
  const workerUrl = localStorage.getItem('mauex_proxy') || PROXY_URL || '';
  const workerToken = getWorkerApiToken();
  const telegramSecret = localStorage.getItem(SIGNAL_TELEGRAM_SECRET_KEY) || '';
  const exchangeKeys = ['binance','bybit','okx','mexc','kucoin']
    .filter(ex => window.G?._hasExchangeKey?.(ex));
  const hasMaster = !!_masterPass;
  const lastProbe = window._lastWorkerProbe || null;

  const workerState = lastProbe?.status === 200 ? 'ok'
    : lastProbe?.status === 429 ? 'warn'
    : workerUrl && workerToken ? 'ok'
    : workerUrl ? 'warn'
    : 'bad';
  const workerDetail = lastProbe?.status === 429
    ? 'Cloudflare devolvio 429. La config local existe, falta validar online.'
    : lastProbe?.ok
    ? 'Worker respondio OK en la ultima prueba.'
    : workerUrl && workerToken
    ? 'URL y API token guardados localmente.'
    : workerUrl
    ? 'URL guardada, falta MAUEX_API_TOKEN.'
    : 'Falta configurar la URL del Worker.';

  const items = [
    operationalStatusItem('Sesion', user?.uid ? 'ok' : 'bad', user?.email || user?.uid ? 'Firebase conectado.' : 'No hay usuario activo.'),
    operationalStatusItem('Worker', workerState, workerDetail),
    operationalStatusItem('API token', workerToken ? 'ok' : 'bad', workerToken ? 'MAUEX_API_TOKEN guardado en este navegador.' : 'Falta pegar el token del Worker.'),
    operationalStatusItem('Master pass', hasMaster ? 'ok' : 'warn', hasMaster ? 'Activa solo en esta sesion.' : 'Necesaria para abrir keys de exchanges.'),
    operationalStatusItem('Exchange keys', exchangeKeys.length ? 'ok' : 'warn', exchangeKeys.length ? `${exchangeKeys.length} exchange(s) con key guardada.` : 'No hay keys de exchange cargadas.'),
    operationalStatusItem('Telegram', telegramSecret ? 'ok' : 'warn', telegramSecret ? 'Secreto local configurado para Signal Desk.' : 'Opcional: falta secreto de Telegram inbox.')
  ];
  grid.innerHTML = items.join('');
  const hint = document.getElementById('operationalStatusHint');
  if (hint) {
    hint.textContent = lastProbe?.status === 429
      ? 'Cloudflare esta bloqueando la prueba online. Podes seguir usando el diagnostico local y reintentar mas tarde.'
      : 'Este estado es local. Para validar Cloudflare, usa Probar Worker cuando baje el 429.';
  }
};

window.showPage = page => {
  // Update bottom nav active state
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  Object.values(PAGES).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const pageEl = document.getElementById(PAGES[page]);
  if (pageEl) pageEl.style.display = 'block';
  if (page === 'calc') {
    window.clearCalculatorEditMode?.();
    window.syncCalcLeveragePlacement?.();
  }

  // Render the page
  const renders = {
    dashboard: renderDashboard,
    signals:   renderSignals,
    watchlist: renderWatchlist,
    orders:    renderOrders,
    positions: renderPositions,
    map:       renderMap,
    history:   renderHistory,
    traders:   renderTraders,
  };
  if (renders[page]) renders[page]();
  if (page === 'signals') {
    setTimeout(() => window.syncTelegramSignals?.(true), 250);
  }
  markNavAlertsSeen(page);
  if (page === 'settings') { loadProxyUrlField(); renderOperationalStatus(); }

  // Sync orders when entering orders page
  if (page === 'orders' && ((PROXY_URL && window.getWorkerApiToken?.()) || (_masterPass && window.G?._hasExchangeKeys?.()))) {
    window.syncAllOrders();
  }

  // Load charts when entering analysis page
  if (page === 'analysis') {
    loadBinanceSymbols();
    setTimeout(()=>{ if(document.getElementById('cs1W')?.innerHTML==='') loadCharts(); }, 200);
  }
  if (page === 'positions' || page === 'map') {
    syncAllExchanges({ force:false, quiet:true });
  }

  // When entering positions, do immediate REST price fetch for any missing prices
  if (page === 'positions' || page === 'map') {
    const G = window.G;
    if (!G) return;
    G.trades().filter(t=>['active','pending','watchlist'].includes(t.status)).forEach(t => {
      const sym = t.ticker?.replace(/USDT|BUSD|USD$/,'').toUpperCase();
      if (!sym || !window.startLivePrices) return;
      const p = G.getPrice ? G.getPrice(sym, t.dir) : null;
      if (p == null || sym === 'XMR') {
        const isStockOrEtf = !appIsCryptoTicker(t.ticker, t.exchange);
        if (isStockOrEtf) {
          fetchYahooSpotPrice(t.ticker)
            .then(px => {
              if (px && window.G) {
                window.G.prices[sym] = {...(window.G.prices[sym] || {}), spot:px};
                renderPositions();
                if (typeof renderMap === 'function') renderMap();
              }
            })
            .catch(()=>{});
          return;
        }
        // Quick REST fetch
        const useKucoin = (t.exchange||'').toUpperCase() === 'KUCOIN' || sym === 'XMR';
        const url = useKucoin
          ? `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym}-USDT`
          : `https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`;
        (window.publicFetch ? window.publicFetch(url) : fetch(url))
          .then(r=>r.json())
          .then(async d=>{
            let px = useKucoin ? Number(d?.data?.price || 0) : Number(d?.price || 0);
            if (!px && sym === 'XMR') {
              try {
                const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd');
                const cd = await cg.json();
                px = Number(cd?.monero?.usd || 0);
              } catch(e) {}
            }
            if (!px && sym === 'XMR') {
              try {
                const kr = await fetch('https://api.kraken.com/0/public/Ticker?pair=XMRUSD');
                const kd = await kr.json();
                px = Number(kd?.result?.XXMRZUSD?.c?.[0] || kd?.result?.XMRUSD?.c?.[0] || 0);
              } catch(e) {}
            }
            if(px && window.G) {
              window.G.prices[sym]={...(window.G.prices[sym]||{}), spot:px};
              renderPositions();
              if (typeof renderMap === 'function') renderMap();
            }
          })
          .catch(()=>{});
      }
    });
  }
};
