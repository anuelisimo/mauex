// ── Proxy config ──────────────────────────────────────────────────────────
// Set this to your Cloudflare Worker URL after deploying worker.js
// Example: 'https://mauex-proxy.tuusuario.workers.dev'
const PROXY_URL = localStorage.getItem('mauex_proxy') || 'https://mauex-proxy.mauaparo.workers.dev';

// Wrap fetch to go through proxy for exchange private APIs
window.proxyFetch = function proxyFetch(url, options={}) {
  if (!PROXY_URL) {
    // No proxy configured - try direct (will fail for private APIs due to CORS)
    return fetch(url, options);
  }
  const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;
  return fetch(proxyUrl, options);
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt  = (n,d=0) => isNaN(n)?'—':n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
// Smart price format: adapts decimals based on magnitude
const fmtPx = n => {
  if(isNaN(n)||n==null) return '—';
  if(n>=1000)  return n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
  if(n>=100)   return n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
  if(n>=1)     return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if(n>=0.01)  return n.toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:4});
  return n.toLocaleString('en-US',{minimumFractionDigits:6,maximumFractionDigits:6});
};
const fmtP = n => isNaN(n)?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
const fmtQty = n => {
  if(isNaN(n)||n==null) return '—';
  const a = Math.abs(n);
  const d = a>=100 ? 2 : a>=10 ? 3 : a>=1 ? 4 : 6;
  return n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:d});
};
const APP_CRYPTOS = ['BTC','ETH','SOL','BNB','XRP','ADA','DOT','AVAX','MATIC','LINK','UNI',
  'ATOM','NEAR','FTM','ALGO','VET','MANA','SAND','AXS','DOGE','LTC','BCH','ETC','XLM',
  'TRX','IOTA','RSR','KAVA','OMG','WAXP','BLOK','VLX','AKRO','AAVE','ONDO','XMR','ANKR',
  'HYPE','CAKE','LINEA','XVG','POL','TAO'];
const APP_CRYPTO_EXCHANGES = ['BINANCE','BYBIT','OKX','MEXC','KUCOIN','GATE','KRAKEN','COINBASE','HUOBI'];
function appIsCryptoTicker(ticker, exchange) {
  if (window.isCryptoTicker) return window.isCryptoTicker(ticker, exchange);
  const ex = String(exchange || '').toUpperCase();
  if (APP_CRYPTO_EXCHANGES.includes(ex)) return true;
  const raw = String(ticker || '').trim().toUpperCase();
  const sym = raw.replace(/USDT|BUSD|USD$/,'');
  return APP_CRYPTOS.includes(sym) || raw.endsWith('USDT') || raw.endsWith('BUSD');
}
async function fetchYahooSpotPrice(ticker) {
  const sym = String(ticker || '').trim().toUpperCase();
  if (!sym) return 0;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`;
  const r = await (window.proxyFetch ? window.proxyFetch(url) : fetch(url));
  const d = await r.json();
  const res = d.chart?.result?.[0];
  const quote = res?.indicators?.quote?.[0]?.close || [];
  const lastClose = quote.filter(x => Number.isFinite(Number(x))).map(Number).pop();
  return Number(res?.meta?.regularMarketPrice || lastClose || res?.meta?.previousClose || 0);
}
window.updateDirectTradeSizeLabel = () => {
  const dir = document.getElementById('dtDir')?.value || 'long';
  const label = document.getElementById('dtSizeLabel');
  const hint = document.getElementById('dtSizeHint');
  const lev = document.getElementById('dtLev');
  if (dir === 'spot') {
    if (label) label.textContent = 'Tamaño spot USD';
    if (hint) hint.textContent = 'Capital comprado en spot. Sin margen ni leverage.';
    if (lev) { lev.value = '1'; lev.disabled = true; }
  } else {
    if (label) label.textContent = 'Margen USD';
    if (hint) hint.textContent = 'Capital usado como margen. MAUex calcula el nominal con el leverage.';
    if (lev) lev.disabled = false;
  }
};
function dirLevLabel(item) {
  const dir = String(item?.dir || '').toUpperCase();
  const lev = Number(item?.leverage || item?.lev || 1);
  if (!dir) return '—';
  if (dir === 'SPOT' || !Number.isFinite(lev) || lev <= 1) return dir;
  return dir + ' x' + lev;
}
function dirBadgeColors(dir) {
  if (dir === 'short') return { color:'#e05252', bg:'rgba(224,82,82,0.12)', border:'rgba(224,82,82,0.25)' };
  if (dir === 'spot') return { color:'var(--blue)', bg:'var(--blue-dim)', border:'rgba(61,156,240,0.28)' };
  return { color:'#22c55e', bg:'rgba(34,197,94,0.12)', border:'rgba(34,197,94,0.25)' };
}
function effectiveTradeSize(t={}) {
  const saved = Number(t.posSize || 0);
  if (saved > 0) return saved;
  const risk = Number(t.risk || 0);
  const entry = Number(t.entry || 0);
  const sl = Number(t.sl || 0);
  if (!risk) return 0;
  if (entry && sl) {
    const slDist = Math.abs(sl - entry) / entry;
    return slDist ? Math.round((risk / slDist) * 100) / 100 : 0;
  }
  if (t.dir === 'spot') return risk;
  return Math.round(risk * (Number(t.leverage || 1) || 1) * 100) / 100;
}
const fmtD = d => {
  if (!d) return '—';
  const str = String(d);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  try { return new Date(d).toLocaleDateString('es',{day:'2-digit',month:'2-digit',year:'2-digit'}); }
  catch(e) { return str || '—'; }
};

window.toast = (msg, type='success') => {
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
};

function installGlobalTooltips() {
  let tipEl = null;
  let touchOpen = false;
  const hide = () => {
    if (tipEl) tipEl.remove();
    tipEl = null;
    touchOpen = false;
  };
  const show = (target, isTouch=false) => {
    const text = target?.dataset?.tip;
    if (!text) return;
    hide();
    tipEl = document.createElement('div');
    tipEl.className = 'mauex-tooltip' + (isTouch ? ' open-touch' : '');
    tipEl.textContent = text;
    (document.body || document.documentElement).appendChild(tipEl);
    const r = target.getBoundingClientRect();
    const tr = tipEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tr.width - 12));
    let top = r.bottom + 9;
    if (top + tr.height > window.innerHeight - 12) top = r.top - tr.height - 9;
    if (top < 12) top = 12;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
    touchOpen = isTouch;
  };
  document.addEventListener('mouseover', e => {
    const target = e.target.closest?.('.info-dot[data-tip]');
    if (target) show(target, false);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest?.('.info-dot[data-tip]') && !touchOpen) hide();
  });
  document.addEventListener('click', e => {
    const target = e.target.closest?.('.info-dot[data-tip]');
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      show(target, true);
      return;
    }
    if (touchOpen) hide();
  });
  window.addEventListener?.('scroll', hide, true);
  window.addEventListener?.('resize', hide);
}

window.openModal  = id => document.getElementById(id).classList.add('open');
window.closeModal = id => document.getElementById(id).classList.remove('open');

function showOrderExecutedModal(order) {
  const body = document.getElementById('orderExecutedBody');
  if (!body) return;
  const dir   = order.dir || '—';
  const dirCls = dir==='long'?'bl':dir==='short'?'bs':'bsp';
  const size  = order.totalSize || order.size || 0;
  const entry = order.entry || order.price || 0;
  const lev   = order.leverage ? ` x${order.leverage}` : '';
  body.innerHTML = `
    <div style="font-family:var(--mono);margin-bottom:14px;">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <span style="font-size:16px;font-weight:600;">${order.ticker||order.symbol||'—'}</span>
        <span class="badge ${dirCls}">${dir.toUpperCase()}${lev}</span>
        <span style="font-size:11px;color:var(--t3);">${order.exchange||''}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">
        <div><div style="font-size:9px;color:var(--t3);text-transform:uppercase;margin-bottom:2px;">Precio de entrada</div><div style="color:#3d9cf0;">$${fmtPx(entry)}</div></div>
        <div><div style="font-size:9px;color:var(--t3);text-transform:uppercase;margin-bottom:2px;">Tamaño</div><div>$${fmt(size)}</div></div>
      </div>
      <div style="margin-top:12px;padding:10px 12px;background:var(--bg3);border-radius:var(--r);font-size:11px;color:var(--t2);line-height:1.6;">
        La orden ya no aparece en el exchange — probablemente fue ejecutada.<br>
        Usá el desplegable en la tarjeta para moverla a Posiciones.
      </div>
    </div>`;
  openModal('orderExecutedModal');
}
document.querySelectorAll('.modal-overlay').forEach(el =>
  el.addEventListener('click', e => { if(e.target===el) el.classList.remove('open'); })
);

// ── Navigation ─────────────────────────────────────────────────────────────
const PAGES = {
  dashboard:'dashPage', calc:'calcPage', watchlist:'watchPage',
  orders:'ordersPage', positions:'posPage', map:'mapPage', history:'histPage',
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

window.showPage = page => {
  // Update bottom nav active state
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  Object.values(PAGES).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const pageEl = document.getElementById(PAGES[page]);
  if (pageEl) pageEl.style.display = 'block';

  // Render the page
  const renders = {
    dashboard: renderDashboard,
    watchlist: renderWatchlist,
    orders:    renderOrders,
    positions: renderPositions,
    map:       renderMap,
    history:   renderHistory,
    traders:   renderTraders,
  };
  if (renders[page]) renders[page]();
  markNavAlertsSeen(page);
  if (page === 'settings') { loadProxyUrlField(); }

  // Sync orders when entering orders page
  if (page === 'orders' && _masterPass && window.G?._hasExchangeKeys?.()) {
    window.syncAllOrders();
  }

  // Load charts when entering analysis page
  if (page === 'analysis') {
    loadBinanceSymbols();
    setTimeout(()=>{ if(document.getElementById('cs1W')?.innerHTML==='') loadCharts(); }, 200);
  }
  if (page === 'positions' || page === 'map') {
    syncAllExchanges();
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
        (useKucoin && window.proxyFetch ? window.proxyFetch(url) : fetch(url))
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

// ── Themes ─────────────────────────────────────────────────────────────────
const THEMES = [
  {id:'default',name:'Classic Green',bg:'#0a0c0f',ac:'#00c47a'},
  {id:'arctic', name:'Arctic Blue',  bg:'#060c18',ac:'#00e5ff'},
  {id:'amber',  name:'Amber Terminal',bg:'#0c0900',ac:'#ffd060'},
  {id:'glass-purple',name:'Glass Purple',bg:'#08041a',ac:'#00ffcc'},
  {id:'glass-teal',  name:'Glass Teal', bg:'#000c10',ac:'#00dca0'},
  {id:'glass-rose',  name:'Glass Rose', bg:'#100408',ac:'#00ffaa'},
  {id:'light',       name:'Light',      bg:'#f0f2f5',ac:'#00a865'},
];
let curTheme = 'default';

window.applyTheme = (t, save=true) => {
  curTheme = t;
  document.documentElement.setAttribute('data-theme', t==='default'?'':t);
  if (save && window.saveTheme) window.saveTheme(t);
  document.querySelectorAll('.theme-opt').forEach(el => el.classList.toggle('sel', el.dataset.t===t));
};

window.openThemePicker = () => {
  document.getElementById('themeGrid').innerHTML = THEMES.map(t=>`
    <div class="theme-opt ${curTheme===t.id?'sel':''}" data-t="${t.id}" onclick="applyTheme('${t.id}')">
      <div class="theme-swatch" style="background:${t.bg};border:2px solid ${t.ac};"></div>
      <div class="theme-name">${t.name}</div>
    </div>`).join('');
  openModal('themeModal');
};

// ── Calc state ─────────────────────────────────────────────────────────────
const calcState = { dir:'short', ex:'binance', lev:null };
const MMR = {binance:.005,bybit:.005,okx:.004,mexc:.005,kucoin:.005};
const MMR_LBL = {binance:'Binance · MMR 0.5%',bybit:'Bybit · MMR 0.5%',okx:'OKX · MMR 0.4%',mexc:'MEXC · MMR 0.5%',kucoin:'KuCoin · MMR 0.5%'};

function estimatedLiquidationPrice(input={}) {
  const dir = String(input.dir || '').toLowerCase();
  const entry = Number(input.entry || 0);
  const lev = Math.max(1, Number(input.leverage || input.lev || 1) || 1);
  if (!entry || lev <= 1 || dir === 'spot') return null;
  const exchange = String(input.exchange || '').toLowerCase();
  const mmr = MMR[exchange] ?? .005;
  const liq = dir === 'short'
    ? entry * (1 + 1 / lev - mmr)
    : entry * (1 - 1 / lev + mmr);
  return Number.isFinite(liq) && liq > 0 ? Math.round(liq * 100000000) / 100000000 : null;
}

function sameLiquidationArea(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  if (!x || !y) return false;
  return Math.abs(x - y) / Math.max(1, Math.abs(y)) < 0.002;
}

function isManualLiquidation(t={}) {
  if (t.liquidationManual === true) return true;
  if (t.liquidationManual === false) return false;
  const liq = Number(t.liquidation || 0);
  if (!liq) return false;
  const estimate = estimatedLiquidationPrice(t);
  return !estimate || !sameLiquidationArea(liq, estimate);
}

function editLiquidationState(existingTrade={}, nextInput={}) {
  const el = document.getElementById('eLiquidation');
  const raw = (el?.value || '').trim();
  const typed = el?.dataset?.userEdited === '1';
  const parsed = Number(raw);
  const coreChanged =
    String(existingTrade.dir || '').toLowerCase() !== String(nextInput.dir || '').toLowerCase() ||
    String(existingTrade.exchange || '').toUpperCase() !== String(nextInput.exchange || '').toUpperCase() ||
    Number(existingTrade.entry || 0) !== Number(nextInput.entry || 0) ||
    Number(existingTrade.leverage || 1) !== Number(nextInput.leverage || 1);
  const explicitManual = existingTrade.liquidationManual === true;
  const manual = !!raw && (typed || explicitManual || !coreChanged);
  const estimate = estimatedLiquidationPrice(nextInput);
  if (manual && Number.isFinite(parsed) && parsed > 0) {
    return { liquidation: parsed, liquidationManual: typed || explicitManual };
  }
  return { liquidation: estimate || null, liquidationManual: false };
}
const LEVS = [2,3,5,7,10,15,20,25,50];

window.setDir = d => {
  calcState.dir = d;
  document.querySelectorAll('[data-d]').forEach(b => {
    b.className = 'dir-btn';
    if (b.dataset.d===d) b.classList.add(d==='long'?'al':d==='short'?'as':'asp');
  });
  const sp = d==='spot';
  document.getElementById('exchSec').style.display = sp?'none':'block';
  document.getElementById('levSec').style.display  = sp?'none':'block';
  document.getElementById('spotNote').style.display = sp?'block':'none';
  compute();
};

window.setEx = ex => {
  calcState.ex = ex;
  document.querySelectorAll('[data-ex]').forEach(b => b.classList.toggle('active', b.dataset.ex===ex));
  document.getElementById('mmrLabel').textContent = MMR_LBL[ex];
  compute();
};

function buildLevGrid() {
  const g = document.getElementById('levGrid');
  g.innerHTML = LEVS.map(l=>`
    <div class="lev-btn ${l===calcState.lev?'sel':''}" onclick="pickLev(${l})">${l}x</div>
  `).join('');
}

window.pickLev = l => {
  calcState.lev = l;
  document.getElementById('levCustom').value = '';
  buildLevGrid();
  compute();
};

window.setCustomLev = v => {
  const n = parseInt(v);
  if (n>=1&&n<=125) {
    calcState.lev = n;
    document.querySelectorAll('.lev-btn').forEach(b=>b.classList.remove('sel'));
    compute();
  }
};

// ── Calc compute ───────────────────────────────────────────────────────────
window.syncEditFields = (changed) => {
  const entry = parseFloat(document.getElementById('eEntry').value)||0;
  const sl    = parseFloat(document.getElementById('eSL').value)||0;
  const size  = parseFloat(document.getElementById('eSize').value)||0;
  const risk  = parseFloat(document.getElementById('eRisk').value)||0;
  if (!entry || !sl) return;
  const slDist = Math.abs(sl-entry)/entry;
  if (slDist <= 0) return;

  const editing = (window.G?.trades()||[]).find(t=>t.id===window._editTradeId);
  const isOpenPosition = editing && ['active','zombie'].includes(editing.status);

  if (changed === 'size' && size) {
    document.getElementById('eRisk').value = Math.round(size * slDist * 100)/100;
  } else if (changed === 'risk' && risk && !isOpenPosition) {
    document.getElementById('eSize').value = Math.round(risk / slDist * 100)/100;
  } else if (changed === 'entry' || changed === 'sl') {
    if (isOpenPosition && size) {
      document.getElementById('eRisk').value = Math.round(size * slDist * 100)/100;
    } else if (risk) {
      document.getElementById('eSize').value = Math.round(risk / slDist * 100)/100;
    } else if (size) {
      document.getElementById('eRisk').value = Math.round(size * slDist * 100)/100;
    }
  }
};

window.compute = () => {
  renderRiskSuggestionPanel();
  const entry = parseFloat(document.getElementById('cEntry').value)||0;
  const sl    = parseFloat(document.getElementById('cSL').value)||0;
  const risk  = parseFloat(document.getElementById('cRisk').value)||0;
  const tp1   = parseFloat(document.getElementById('cTP1').value)||0;
  const tp2   = parseFloat(document.getElementById('cTP2').value)||0;
  const tp3   = parseFloat(document.getElementById('cTP3').value)||0;
  const calcInvs = readInvalidationFields('c');
  const tp1pct= (parseFloat(document.getElementById('cTP1pct').value)||33)/100;
  const tp2pct= (parseFloat(document.getElementById('cTP2pct').value)||33)/100;
  const tp3pct= (parseFloat(document.getElementById('cTP3pct').value)||34)/100;

  if (!entry) {
    ['calcMetrics','calcLevels','calcBar'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.innerHTML='';
    });
    return;
  }

  const sp  = calcState.dir==='spot';
  const sh  = calcState.dir==='short';
  const lev = calcState.lev||1;
  const mmr = MMR[calcState.ex]||.005;
  const hasSL   = sl > 0;
  const hasRisk = risk > 0;
  const sizeManual = parseFloat(document.getElementById('cSize')?.value) || 0;
  const slDist  = hasSL ? Math.abs(sl-entry)/entry : 0;
  // Use manual size if provided, otherwise calculate from risk+SL
  const posSize = sizeManual > 0 ? sizeManual : (hasSL && hasRisk ? risk/slDist : (hasRisk ? (sp ? risk : risk * lev) : 0));
  const margin  = posSize ? (sp?posSize:posSize/lev) : 0;
  const liq     = !sp ? estimatedLiquidationPrice({ dir:calcState.dir, entry, leverage:lev, exchange:calcState.ex }) : null;
  const liqSafe = !liq||(sh?liq>sl:liq<sl);

  // Alerts
  const a1=document.getElementById('calcAlert1'),a2=document.getElementById('calcAlert2');
  const warns=[];
  if(hasSL && sh&&sl<=entry) warns.push('SL debe ser MAYOR al Entry para SHORT');
  if(hasSL && !sh&&!sp&&sl>=entry) warns.push('SL debe ser MENOR al Entry para LONG');
  if(hasSL && !liqSafe) warns.push('🔴 Liquidación más cercana que el SL — reducí el apalancamiento');
  const danger=warns.filter(w=>w.includes('🔴')), other=warns.filter(w=>!w.includes('🔴'));
  a1.style.display=danger.length?'block':'none'; a1.textContent=danger.join(' · ');
  a2.style.display=other.length?'block':'none';  a2.textContent=other.join(' · ');

  // Metrics — solo si hay SL y riesgo
  const rrParts = [[tp1,tp1pct],[tp2,tp2pct],[tp3,tp3pct]]
    .filter(([price,pct]) => hasSL && price > 0 && pct > 0)
    .map(([price,pct]) => ({ rr: Math.abs((price-entry)/(sl-entry)), pct }));
  const rrWeight = rrParts.reduce((s,r) => s + r.pct, 0);
  const weightedRR = rrWeight ? rrParts.reduce((s,r) => s + r.rr * r.pct, 0) / rrWeight : null;

  document.getElementById('calcMetrics').innerHTML= hasSL && hasRisk ? [
    {l:'Tamaño posición',v:'$'+fmt(posSize)},
    {l:sp?'Capital':'Margen isolated',v:'$'+fmt(margin)},
    {l:'SL % margen',v:(slDist*(sp?1:lev)*100).toFixed(1)+'%',cls:slDist*lev*100>50?'red':''},
    ...(weightedRR!=null?[{l:'R:R ponderado',v:weightedRR.toFixed(2)+':1',cls:weightedRR>=2?'green':weightedRR>=1?'':'red'}]:[]),
    ...(!sp&&liq?[{l:'Liquidación',v:'$'+fmtPx(liq),cls:liqSafe?'':'red'}]:[]),
  ].map(m=>`<div class="metric"><div class="metric-lbl">${m.l}</div><div class="metric-val ${m.cls||''}">${m.v}</div></div>`).join('') : '';

  // Levels table
  const sign = sh ? -1 : 1;
  const pnlAtTP = (tpPrice, pct) => posSize ? Math.round((tpPrice-entry)/entry * posSize * pct * sign * 100)/100 : null;
  let cumPnl = 0;
  const tpRows = [];
  if(tp1){ const p=pnlAtTP(tp1,tp1pct); if(p!=null) cumPnl+=p; tpRows.push({l:'TP1',price:tp1,pnl:p,cum:p!=null?cumPnl:null,rr:hasSL?Math.abs((tp1-entry)/(sl-entry)):null,pct:tp1pct}); }
  if(tp2){ const p=pnlAtTP(tp2,tp2pct); if(p!=null) cumPnl+=p; tpRows.push({l:'TP2',price:tp2,pnl:p,cum:p!=null?cumPnl:null,rr:hasSL?Math.abs((tp2-entry)/(sl-entry)):null,pct:tp2pct}); }
  if(tp3){ const p=pnlAtTP(tp3,tp3pct); if(p!=null) cumPnl+=p; tpRows.push({l:'TP3',price:tp3,pnl:p,cum:p!=null?cumPnl:null,rr:hasSL?Math.abs((tp3-entry)/(sl-entry)):null,pct:tp3pct}); }

  const levelRows = [
    {l:'Entry',price:entry,pnl:null,cum:null,rr:null,pct:null,isEntry:true},
    ...tpRows,
    ...(hasSL?[{l:'SL',price:sl,pnl:hasRisk?-risk:null,cum:hasRisk?-risk:null,rr:null,pct:null,isSL:true}]:[]),
    ...(!sp&&liq?[{l:'LIQ',price:liq,pnl:null,cum:null,rr:null,pct:null,isLiq:true}]:[]),
  ];

  document.getElementById('calcLevels').innerHTML= levelRows.length > 1 ? `
    <div style="display:grid;grid-template-columns:52px 1fr 60px 80px 70px 55px;padding:5px 0;border-bottom:0.5px solid var(--border);">
      ${['Nivel','Precio','%','PnL parc.','PnL acum.','R:R'].map(h=>`<span style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;">${h}</span>`).join('')}
    </div>
    ${levelRows.map(r=>`
    <div style="display:grid;grid-template-columns:52px 1fr 60px 80px 70px 55px;padding:8px 0;border-bottom:0.5px solid var(--border);align-items:center;">
      <span class="badge ${r.isSL?'bs':r.isLiq?'bw':r.isEntry?'be':'bl'}">${r.l}</span>
      <div><span style="font-family:var(--mono);font-size:12px;font-weight:600;">$${fmtPx(r.price)}</span>
        <span style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-left:4px;">${fmtP((r.price-entry)/entry*100)}</span></div>
      <span style="font-family:var(--mono);font-size:10px;color:var(--t3);">${r.pct!=null?Math.round(r.pct*100)+'%':''}</span>
      <span style="font-family:var(--mono);font-size:11px;" class="${r.pnl==null?'':r.pnl>=0?'pnl-pos':'pnl-neg'}">${r.pnl!=null?(r.pnl>=0?'+':'')+fmt(r.pnl):''}</span>
      <span style="font-family:var(--mono);font-size:11px;" class="${r.cum==null?'':r.cum>=0?'pnl-pos':'pnl-neg'}">${r.cum!=null?(r.cum>=0?'+':'')+fmt(r.cum):''}</span>
      <span style="font-family:var(--mono);font-size:11px;font-weight:600;color:${r.rr==null?'var(--t3)':r.rr>=2?'var(--accent)':'var(--red)'};">${r.rr!=null?r.rr.toFixed(2)+':1':''}</span>
    </div>`).join('')}` : '';

  // Price bar
  const all=[entry,...(hasSL?[sl]:[]),...(tp1?[tp1]:[]),...(tp2?[tp2]:[]),...(tp3?[tp3]:[]),...(liq?[liq]:[]),...calcInvs.map(x=>x.price)].filter(v=>v>0);
  const minP=Math.min(...all)*.985, maxP=Math.max(...all)*1.015, range=maxP-minP||1;
  const pct=v=>Math.min(98,Math.max(2,((v-minP)/range*100))).toFixed(2);
  const pts=[{v:entry,l:'Entry',c:'var(--t1)'},{v:sl,l:'SL',c:'var(--red)'},
    ...(tp1?[{v:tp1,l:'TP1',c:'var(--accent)'}]:[]),
    ...(tp2?[{v:tp2,l:'TP2',c:'var(--accent)'}]:[]),
    ...(tp3?[{v:tp3,l:'TP3',c:'var(--accent)'}]:[]),
    ...calcInvs.map((x,i)=>({v:x.price,l:x.label||`Inv ${i+1}`,c:'#38bdf8'})),
    ...(!sp&&liq?[{v:liq,l:'Liq',c:'var(--amber)'}]:[])];
  // Build gradient TP zones: each zone gets progressively more opaque green
  const tpZones = [
    ...(tp1?[{from:entry,to:tp1,op:.25}]:[]),
    ...(tp2?[{from:tp1||entry,to:tp2,op:.45}]:[]),
    ...(tp3?[{from:tp2||tp1||entry,to:tp3,op:.65}]:[]),
  ];
  document.getElementById('calcBar').innerHTML=`
    <div style="position:absolute;width:100%;height:6px;background:var(--bg4);border-radius:3px;top:0;"></div>
    <div style="position:absolute;left:${pct(Math.min(entry,sl))}%;width:${Math.abs(pct(sl)-pct(entry))}%;height:6px;background:var(--red);opacity:.5;border-radius:3px;top:0;"></div>
    ${tpZones.map(z=>`<div style="position:absolute;left:${pct(Math.min(entry,z.to))}%;width:${Math.abs(pct(z.to)-pct(z.from))}%;height:6px;background:var(--accent);opacity:${z.op};border-radius:3px;top:0;"></div>`).join('')}
    ${pts.map(p=>`
      <div style="position:absolute;left:${pct(p.v)}%;transform:translateX(-50%);top:-20px;text-align:center;">
        <div style="font-size:8px;color:${p.c};font-family:var(--mono);font-weight:600;white-space:nowrap;">${p.l}</div>
        <div style="width:1.5px;height:20px;background:${p.c};margin:1px auto;"></div>
      </div>
      <div style="position:absolute;left:${pct(p.v)}%;transform:translateX(-50%);top:10px;font-size:8px;color:${p.c};font-family:var(--mono);white-space:nowrap;">$${fmtPx(p.v)}</div>`).join('')}`;
};

// ── Dashboard ──────────────────────────────────────────────────────────────
let chPnl, chWR, chA;
let _liquidityCache = null; // cache so we don't re-fetch on every render

function normalizeDashboardBalance(raw = {}) {
  const usdt = Number(raw.USDT ?? raw.usdt ?? 0) || 0;
  const usdc = Number(raw.USDC ?? raw.usdc ?? 0) || 0;
  const fallbackTotal = usdt + usdc;
  const total = Number(raw.total ?? raw.totalEquity ?? raw.wallet ?? fallbackTotal) || 0;
  const free = Number(raw.free ?? raw.available ?? raw.availableBalance ?? (fallbackTotal || total)) || 0;
  const margin = Number(raw.margin ?? raw.marginUsed ?? 0) || 0;
  const orders = Number(raw.orders ?? raw.orderMargin ?? 0) || 0;
  const pnl = Number(raw.pnl ?? raw.unrealizedPnl ?? raw.upnl ?? 0) || 0;

  return { total, free, margin, orders, pnl, USDT: usdt, USDC: usdc };
}

function dashboardTradeCapital(t) {
  const size = Number(t?.posSize ?? t?.totalSize ?? t?.size ?? 0) || 0;
  const lev = Math.max(1, Number(t?.leverage) || 1);
  return (String(t?.dir || '').toLowerCase() === 'spot') ? size : size / lev;
}

function manualExchangeCapitalOverlay() {
  const out = {};
  const trades = window.G?.trades?.() || [];
  trades.forEach(t => {
    const ex = ((t.exchange || 'MANUAL') + '').toUpperCase();
    if (!ex || ex === 'MANUAL') return;
    if (!out[ex]) out[ex] = { margin: 0, orders: 0 };
    const capital = dashboardTradeCapital(t);
    if (t.status === 'active' || t.status === 'zombie') out[ex].margin += capital;
    if (t.status === 'pending') out[ex].orders += capital;
  });
  return out;
}

function applyManualCapitalOverlay(data) {
  if (!data) return data;
  const manual = manualExchangeCapitalOverlay();
  const sourceBalances = data.balances || {};
  const balanceErrors = data.errors || data.balanceErrors || {};
  const balances = {};

  Object.entries(sourceBalances).forEach(([ex, raw]) => {
    const b = normalizeDashboardBalance(raw);
    const m = manual[ex] || { margin: 0, orders: 0 };
    const margin = Math.max(b.margin || 0, m.margin || 0);
    const orders = Math.max(b.orders || 0, m.orders || 0);
    const total = b.total || 0;
    balances[ex] = {
      ...b,
      margin: Math.round(margin * 100) / 100,
      orders: Math.round(orders * 100) / 100,
      free: Math.round(Math.max(0, total - margin - orders) * 100) / 100,
      manualMargin: Math.round((m.margin || 0) * 100) / 100,
      manualOrders: Math.round((m.orders || 0) * 100) / 100,
    };
  });

  Object.entries(manual).forEach(([ex, m]) => {
    if (balances[ex]) return;
    const margin = Math.round((m.margin || 0) * 100) / 100;
    const orders = Math.round((m.orders || 0) * 100) / 100;
    const total = Math.round((margin + orders) * 100) / 100;
    if (total <= 0 && !balanceErrors[ex]) return;
    balances[ex] = {
      total,
      free: 0,
      margin,
      orders,
      pnl: 0,
      USDT: total,
      USDC: 0,
      manualOnly: true,
      manualMargin: margin,
      manualOrders: orders,
    };
  });

  Object.entries(balanceErrors).forEach(([ex, err]) => {
    const key = String(ex || '').toUpperCase();
    if (!key) return;
    if (!balances[key]) {
      balances[key] = { total: 0, free: 0, margin: 0, orders: 0, pnl: 0, USDT: 0, USDC: 0 };
    }
    balances[key].error = String(err || 'Error de conexion');
  });

  let USDT = 0, USDC = 0, total = 0;
  Object.values(balances).forEach(b => {
    USDT += b.USDT || 0;
    USDC += b.USDC || 0;
    total += b.total || 0;
  });

  return {
    ...data,
    balances,
    errors: balanceErrors,
    liquidity: {
      ...(data.liquidity || data.totals || {}),
      USDT: Math.round(USDT * 100) / 100,
      USDC: Math.round(USDC * 100) / 100,
      total: Math.round(total * 100) / 100,
    },
    totals: {
      ...(data.totals || data.liquidity || {}),
      USDT: Math.round(USDT * 100) / 100,
      USDC: Math.round(USDC * 100) / 100,
      total: Math.round(total * 100) / 100,
    },
  };
}

async function fetchAndRenderLiquidity() {
  const el = document.getElementById('dashLiquidity');
  if (!el) return;

  let data = _liquidityCache;

  if (!data && PROXY_URL) {
    try {
      el.style.display = 'block';
      el.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--t3);font-family:var(--mono);font-size:11px;">⟳ Cargando capital...</div>`;
      const r = await fetch(`${PROXY_URL}/balance?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        data = applyManualCapitalOverlay(d);
        if (data?.balances) {
          _liquidityCache = data;
          window._liquidityCache = data;
          if (window._drawCapitalPie) setTimeout(window._drawCapitalPie, 50);
        }
      }
    } catch(e) {}
  }

  data = applyManualCapitalOverlay(data);

  if (!data?.balances || Object.keys(data.balances).length === 0) {
    const balanceErrors = data?.errors || data?.balanceErrors || {};
    if (Object.keys(balanceErrors).length) {
      el.style.display = 'block';
      el.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--red);font-family:var(--mono);font-size:11px;">
        No pude leer capital de exchanges: ${Object.entries(balanceErrors).map(([ex,msg])=>`${ex}: ${msg}`).join(' | ')}
      </div>`;
      return;
    }
    el.style.display = 'none';
    return;
  }

  _liquidityCache = data;
  window._liquidityCache = data;
  window.syncApiModalStatus?.();

  const balances = Object.fromEntries(
    Object.entries(data.balances).map(([ex, b]) => [ex, { ...normalizeDashboardBalance(b), error: b?.error, manualOnly: !!b?.manualOnly }])
  );

  // Totals — pure exchange data, no Firestore crossing
  let grandTotal = 0, grandFree = 0, grandMargin = 0, grandOrders = 0, grandPnl = 0;
  Object.values(balances).forEach(b => {
    grandTotal  += b.total  || 0;
    grandFree   += b.free   || 0;
    grandMargin += b.margin || 0;
    grandOrders += b.orders || 0;
    grandPnl    += b.pnl    || 0;
  });

  const exRows = Object.entries(balances).map(([ex, b]) => {
    const total  = b.total  || 0;
    const free   = b.free   || 0;
    const margin = b.margin || 0;
    const orders = b.orders || 0;
    const pnl    = b.pnl    || 0;
    const err    = b.error || data.errors?.[ex] || data.balanceErrors?.[ex];
    if (total === 0 && margin === 0 && orders === 0 && !err) return '';

    const pnlStr = pnl !== 0
      ? `<span style="color:${pnl>=0?'var(--accent)':'var(--red)'};">${pnl>=0?'+':''}$${fmt(pnl)}</span>`
      : '<span style="color:var(--t3);">—</span>';

    const exNote = err
      ? `<div style="font-size:8px;color:var(--red);font-family:var(--mono);margin-top:2px;">API error</div>`
      : b.manualOnly
        ? `<div style="font-size:8px;color:var(--amber);font-family:var(--mono);margin-top:2px;">MAUex manual</div>`
        : '';
    const totalStr = total > 0 ? '$' + fmt(total) : '-';

    return `<div style="display:grid;grid-template-columns:80px 1fr 1fr 1fr 1fr 90px;gap:4px;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border);">
      <span style="font-size:10px;font-weight:600;color:var(--t1);font-family:var(--mono);" title="${dashSafe(err || '')}">${ex}${exNote}</span>
      <div>
        <div style="font-size:8px;color:var(--t3);font-family:var(--mono);">LIBRE</div>
        <div style="font-size:11px;font-family:var(--mono);color:#3d9cf0;">${free>0?'$'+fmt(free):'—'}</div>
      </div>
      <div>
        <div style="font-size:8px;color:var(--t3);font-family:var(--mono);">EN MARGEN</div>
        <div style="font-size:11px;font-family:var(--mono);color:#a78bfa;">${margin>0?'$'+fmt(margin):'—'}</div>
      </div>
      <div>
        <div style="font-size:8px;color:var(--t3);font-family:var(--mono);">EN ÓRDENES</div>
        <div style="font-size:11px;font-family:var(--mono);color:var(--amber);">${orders>0?'$'+fmt(orders):'—'}</div>
      </div>
      <div>
        <div style="font-size:8px;color:var(--t3);font-family:var(--mono);">PNL</div>
        <div style="font-size:11px;font-family:var(--mono);">${pnlStr}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:8px;color:var(--t3);font-family:var(--mono);">TOTAL</div>
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--t1);">${totalStr}</div>
      </div>
    </div>`;
  }).join('');

  el.style.display = 'block';
  const detailsId = 'liqDetails_' + Date.now();
  el.innerHTML = `
  <div class="card" style="padding:16px 20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <span style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;">Capital en exchanges</span>
      <button onclick="const d=document.getElementById('${detailsId}');const b=document.getElementById('${detailsId}_btn');const open=d.style.display!=='none';d.style.display=open?'none':'block';b.textContent=open?'▼':'▲';"
        id="${detailsId}_btn"
        style="background:none;border:0.5px solid var(--border2);border-radius:4px;padding:2px 8px;cursor:pointer;color:var(--t3);font-size:11px;">▼</button>
    </div>

    <!-- Summary: Total first, then breakdown -->
    <div style="display:grid;grid-template-columns:1.2fr 0.5px 1fr 1fr 1fr 1fr;gap:0;margin-bottom:0;" class="capital-summary-grid">
      <div style="padding-right:20px;">
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px;">Total</div>
        <div style="font-family:var(--mono);font-size:24px;font-weight:700;color:var(--accent);">$${fmt(grandTotal)}</div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">todos los exchanges</div>
      </div>
      <div style="background:var(--border);width:0.5px;margin:0 16px;"></div>
      <div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px;">Libre</div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:#3d9cf0;">$${fmt(grandFree)}</div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">disponible</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px;">En margen</div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:#a78bfa;">$${fmt(grandMargin)}</div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">posiciones</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px;">En órdenes</div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--amber);">$${fmt(grandOrders)}</div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">limit orders</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px;">PnL abierto</div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:600;" class="${grandPnl>=0?'pnl-pos':'pnl-neg'}">${grandPnl>=0?'+':''}$${fmt(grandPnl)}</div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">no realizado</div>
      </div>
    </div>

    <!-- Expandable per-exchange details -->
    <div id="${detailsId}" style="display:none;margin-top:14px;padding-top:12px;border-top:0.5px solid var(--border2);">
      <div style="display:grid;grid-template-columns:80px 1fr 1fr 1fr 1fr 90px;gap:4px;padding-bottom:4px;margin-bottom:2px;">
        ${['Exchange','Libre','En margen','En órdenes','PnL','Total'].map((h,i) =>
          `<span style="font-size:8px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;${i===5?'text-align:right;':''}">${h}</span>`
        ).join('')}
      </div>
      ${exRows}
    </div>
  </div>`;
}

// Called after each sync to update liquidity display
window._updateLiquidityCache = (data) => {
  const displayData = applyManualCapitalOverlay(data);
  if (displayData?.balances) {
    _liquidityCache = displayData;
    window._liquidityCache = displayData;
    if (window._drawCapitalPie) setTimeout(window._drawCapitalPie, 50);
    window.syncApiModalStatus?.();
  }
  fetchAndRenderLiquidity();
};

const dashSafe = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dashPnl = t => Number(t?.pnl) || 0;
const dashClosedAt = t => t?.closeDate || t?.closedAt || t?.updatedAt || t?.createdAt || '';
const dashRiskOf = t => {
  const entry = Number(t?.entry) || 0;
  const sl = Number(t?.sl) || 0;
  const size = Number(t?.originalPosSize || t?.posSize) || 0;
  if (!entry || !sl || !size) return 0;
  return Math.abs((entry - sl) / entry * size);
};
const openRiskOf = t => {
  const entry = Number(t?.entry) || 0;
  const sl = Number(t?.sl) || 0;
  const size = Number(t?.posSize) || 0;
  if (!size) return 0;
  if (!entry || !sl) return (t?.dir === 'spot') ? size : size / (Number(t?.leverage) || 1);
  return Math.abs((entry - sl) / entry * size);
};
const signalExecutionOf = t => {
  if (Number.isFinite(Number(t?.signalPnl)) || Number.isFinite(Number(t?.executionDelta))) {
    const signalPnl = Number(t?.signalPnl) || 0;
    const realPnl = dashPnl(t);
    return {
      signalPnl,
      realPnl,
      executionDelta: Number.isFinite(Number(t?.executionDelta)) ? Number(t.executionDelta) : Math.round((realPnl - signalPnl) * 100) / 100,
      signalExitPrice: Number(t?.signalExitPrice) || 0,
      signalLevel: t?.signalLevel || '',
    };
  }
  if (typeof window.signalExecutionForClose === 'function') {
    return window.signalExecutionForClose(t, {
      closeLevel: t?.closeLevel || '',
      closeReason: t?.closeReason || '',
      closePrice: t?.closePrice || t?.exitPrice || t?.exit || 0,
      posSize: t?.posSize || 0,
      pnl: dashPnl(t),
    });
  }
  const realPnl = dashPnl(t);
  return { signalPnl: realPnl, realPnl, executionDelta: 0, signalExitPrice: Number(t?.closePrice)||0, signalLevel:'manual' };
};
const signalStatsOf = trades => {
  const rows = trades.map(t => ({ trade:t, ...signalExecutionOf(t) }));
  const signalPnl = rows.reduce((s,x)=>s+(Number(x.signalPnl)||0),0);
  const realPnl = rows.reduce((s,x)=>s+(Number(x.realPnl)||0),0);
  const executionDelta = Math.round((realPnl - signalPnl) * 100) / 100;
  return { rows, signalPnl, realPnl, executionDelta };
};
const dashStatsOf = (trades) => {
  const wins = trades.filter(t => dashPnl(t) > 0);
  const losses = trades.filter(t => dashPnl(t) < 0);
  const grossWin = wins.reduce((s,t)=>s+dashPnl(t),0);
  const grossLoss = Math.abs(losses.reduce((s,t)=>s+dashPnl(t),0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const pnl = trades.reduce((s,t)=>s+dashPnl(t),0);
  const winRate = trades.length ? wins.length / trades.length : 0;
  const expectancy = trades.length ? pnl / trades.length : 0;
  const rrValues = trades.map(t => {
    const risk = dashRiskOf(t);
    return risk ? dashPnl(t) / risk : null;
  }).filter(v => Number.isFinite(v));
  const avgR = rrValues.length ? rrValues.reduce((s,v)=>s+v,0) / rrValues.length : 0;
  const sorted = [...trades].sort((a,b)=>(new Date(dashClosedAt(a)).getTime()||0)-(new Date(dashClosedAt(b)).getTime()||0));
  let equity = 0, peak = 0, maxDd = 0;
  sorted.forEach(t => {
    equity += dashPnl(t);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  });
  const vals = trades.map(dashPnl);
  const avg = vals.length ? vals.reduce((s,v)=>s+v,0) / vals.length : 0;
  const variance = vals.length ? vals.reduce((s,v)=>s+Math.pow(v-avg,2),0) / vals.length : 0;
  const sharpe = variance ? (avg / Math.sqrt(variance)) * Math.sqrt(vals.length) : 0;
  return {count:trades.length,wins:wins.length,losses:losses.length,pnl,winRate,avgWin,avgLoss,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),expectancy,maxDd,avgR,sharpe};
};
const infoDot = text => text ? `<span class="info-dot" data-tip="${dashSafe(text)}" title="${dashSafe(text)}">i</span>` : '';
const dashMetricInfo = {
  'PnL total':'Resultado neto acumulado de todos los trades cerrados del historial.',
  'Win rate':'Porcentaje de trades cerrados con PnL positivo.',
  'Profit factor':'Ganancias brutas divididas por perdidas brutas. Arriba de 1 indica sistema rentable.',
  'Expectancy':'Promedio esperado por trade. Es el PnL total dividido por la cantidad de trades.',
  'Max drawdown':'Mayor caida acumulada desde un pico de la curva de equity.',
  'Avg win / loss':'Ganancia promedio de los trades ganadores comparada contra perdida promedio de los perdedores.',
  'R promedio':'Resultado promedio medido contra el riesgo definido por el SL. Solo cuenta trades con SL cargado.',
  'Sharpe simple':'Relacion simple entre retorno promedio y variabilidad de resultados. Cuanto mas alto, mas consistente.',
  'Trades cerrados':'Cantidad de operaciones cerradas en el historial.',
  'PnL este mes':'Resultado neto de los trades cerrados durante el mes actual.',
  'Mejor trade':'Trade cerrado con mayor ganancia en dolares.',
  'Peor trade':'Trade cerrado con mayor perdida en dolares.',
  'Traders seguidos':'Cantidad de traders distintos asociados a tus operaciones.',
  'Activos operados':'Cantidad de tickers distintos registrados en la app.',
  'Signal PnL':'Resultado estimado usando el plan original del trader para el nivel cerrado.',
  'Execution delta':'Diferencia entre tu PnL real y el Signal PnL. Positivo significa que tu gestion agrego valor; negativo significa que capturaste menos que el plan.',
};
const dashMetricCard = m => `<div class="metric">${infoDot(m.info || dashMetricInfo[m.l])}<div class="metric-lbl">${m.l}</div><div class="metric-val ${m.cls||''}">${m.v}</div>${m.sub?`<div class="metric-sub">${m.sub}</div>`:''}</div>`;
const dashMoney = v => `${v>=0?'+':'-'}$${fmt(Math.abs(v))}`;
const signalGroupStats = (trades, keyFn) => {
  const grouped = dashGroupStats(trades, keyFn);
  return grouped.map(row => ({ ...row, signal: signalStatsOf(row.trades) }))
    .sort((a,b)=>b.signal.executionDelta-a.signal.executionDelta);
};
window.signalGroupStats = signalGroupStats;
const dashGroupStats = (trades, keyFn) => {
  const map = {};
  trades.forEach(t => {
    const key = keyFn(t) || 'Sin dato';
    if (!map[key]) map[key] = [];
    map[key].push(t);
  });
  return Object.keys(map).map(name => ({name, trades:map[name], stats:dashStatsOf(map[name])})).sort((a,b)=>b.stats.pnl-a.stats.pnl);
};
const dashProfessionalRow = (row) => {
  const s = row.stats;
  const pf = s.profitFactor === Infinity ? 'INF' : s.profitFactor.toFixed(2);
  return `<tr>
    <td><strong>${dashSafe(row.name)}</strong></td>
    <td>${s.count}</td>
    <td class="${s.pnl>=0?'pnl-pos':'pnl-neg'}">${dashMoney(s.pnl)}</td>
    <td>${Math.round(s.winRate*100)}%</td>
    <td>${pf}</td>
    <td class="${s.expectancy>=0?'pnl-pos':'pnl-neg'}">${dashMoney(s.expectancy)}</td>
  </tr>`;
};
const sampleConfidenceOf = count => {
  const n = Number(count) || 0;
  if (n >= 12) return { mult:1, label:'Alta', note:'muestra alta' };
  if (n >= 7) return { mult:.88, label:'Media', note:'muestra media' };
  if (n >= 4) return { mult:.72, label:'Baja', note:'muestra baja' };
  return { mult:.55, label:'Insuficiente', note:'muestra insuficiente' };
};
const signalPerformanceStatsOf = trades => {
  const rows = (trades || []).map(t => ({ trade:t, ...signalExecutionOf(t) }));
  const wins = rows.filter(x => Number(x.signalPnl) > 0);
  const losses = rows.filter(x => Number(x.signalPnl) < 0);
  const grossWin = wins.reduce((s,x)=>s+(Number(x.signalPnl)||0),0);
  const grossLoss = Math.abs(losses.reduce((s,x)=>s+(Number(x.signalPnl)||0),0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const signalPnl = rows.reduce((s,x)=>s+(Number(x.signalPnl)||0),0);
  const count = rows.length;
  const winRate = count ? wins.length / count : 0;
  const expectancy = count ? signalPnl / count : 0;
  return {
    count,
    wins:wins.length,
    losses:losses.length,
    signalPnl,
    winRate,
    avgWin,
    avgLoss,
    profitFactor:grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
    expectancy,
  };
};
window.signalPerformanceStatsOf = signalPerformanceStatsOf;
const traderSignalScore = row => {
  const s = signalPerformanceStatsOf(row.trades || []);
  const signal = row.signal || signalStatsOf(row.trades || []);
  const pf = s.profitFactor === Infinity ? 3 : Math.max(0, Math.min(3, Number(s.profitFactor)||0));
  const wr = Math.max(0, Math.min(1, Number(s.winRate)||0));
  const expectancy = Number(s.expectancy)||0;
  const avgAbs = Math.max(Math.abs(Number(s.avgWin)||0), Math.abs(Number(s.avgLoss)||0), 1);
  const expectancyScore = Math.max(0, Math.min(1, (expectancy / avgAbs + 1) / 2));
  const signalPnlScore = Number(signal.signalPnl) > 0 ? 1 : Number(signal.signalPnl) === 0 ? .45 : 0;
  const avgSignal = (Number(signal.signalPnl)||0) / Math.max(1, Number(s.count)||1);
  const signalExpectancyScore = Math.max(0, Math.min(1, (avgSignal / avgAbs + 1) / 2));
  const raw = (pf/3)*24 + wr*22 + expectancyScore*18 + signalPnlScore*20 + signalExpectancyScore*16;
  const sample = sampleConfidenceOf(s.count);
  return Math.round(raw * sample.mult);
};
const executionCaptureScore = row => {
  const signal = row.signal || signalStatsOf(row.trades || []);
  if (Number(signal.signalPnl) <= 0) return Number(signal.executionDelta) >= 0 ? 70 : 45;
  const capture = Math.max(0, Math.min(1.25, Number(signal.realPnl || 0) / Number(signal.signalPnl || 1)));
  return Math.round(Math.min(100, capture * 100));
};
const traderEdgeScore = row => traderSignalScore(row);
const traderScoreMeta = row => {
  const signalScore = traderSignalScore(row);
  const executionScore = executionCaptureScore(row);
  const sample = sampleConfidenceOf(row?.stats?.count || 0);
  const capture = row?.signal?.signalPnl > 0 ? Math.round((row.signal.realPnl / row.signal.signalPnl) * 100) : null;
  return { signalScore, executionScore, sample, capture };
};
window.traderSignalScore = traderSignalScore;
window.executionCaptureScore = executionCaptureScore;
window.traderEdgeScore = traderEdgeScore;
window.traderScoreMeta = traderScoreMeta;
const traderEdgeState = row => {
  const score = traderSignalScore(row);
  const sample = sampleConfidenceOf(row?.stats?.count || 0);
  if (sample.label === 'Insuficiente') return { label:'Muestra baja', color:'var(--amber)', tone:'warn' };
  if (score >= 75) return { label:'Prioridad', color:'var(--accent)', tone:'good' };
  if (score >= 60) return { label:'Normal', color:'var(--blue)', tone:'neutral' };
  if (score >= 45) return { label:'Reducir', color:'var(--amber)', tone:'warn' };
  return { label:'Observacion', color:'var(--red)', tone:'bad' };
};
window.traderEdgeState = traderEdgeState;
function renderTraderEdgeVisual(rows) {
  if (!rows.length) return '';
  const enriched = rows.map(row => ({ ...row, edgeScore: traderSignalScore(row), executionScore: executionCaptureScore(row), scoreMeta: traderScoreMeta(row), edgeState: traderEdgeState(row) }))
    .sort((a,b)=>b.edgeScore-a.edgeScore || b.stats.count-a.stats.count);
  const maxAbsPnl = Math.max(1, ...enriched.map(r => Math.abs(Number(r.signal?.realPnl)||0)));
  const maxTrades = Math.max(1, ...enriched.map(r => Number(r.stats?.count)||0));
  const xOf = pnl => 360 + (Number(pnl)||0) / maxAbsPnl * 270;
  const yOf = score => 226 - (Number(score)||0) / 100 * 172;
  const topSignal = [...enriched].sort((a,b)=>(b.signal?.signalPnl||0)-(a.signal?.signalPnl||0))[0];
  const topReal = [...enriched].sort((a,b)=>(b.signal?.realPnl||0)-(a.signal?.realPnl||0))[0];
  const topDelta = [...enriched].sort((a,b)=>(b.signal?.executionDelta||0)-(a.signal?.executionDelta||0))[0];
  const topScore = enriched[0];
  const topCapture = [...enriched].filter(r => r.scoreMeta?.capture != null).sort((a,b)=>(b.scoreMeta.capture||0)-(a.scoreMeta.capture||0))[0];
  const mini = (label, row, val, cls) => `<div style="background:var(--bg3);border-radius:var(--r);padding:12px;min-width:0;">
    <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:5px;">${label}</div>
    <div style="font-family:var(--mono);font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dashSafe(row?.name || '-')}</div>
    <div class="${cls}" style="font-family:var(--mono);font-size:14px;font-weight:800;margin-top:4px;">${dashMoney(val || 0)}</div>
  </div>`;
  const miniText = (label, row, val, color='var(--accent)') => `<div style="background:var(--bg3);border-radius:var(--r);padding:12px;min-width:0;">
    <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;margin-bottom:5px;">${label}</div>
    <div style="font-family:var(--mono);font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dashSafe(row?.name || '-')}</div>
    <div style="font-family:var(--mono);font-size:14px;font-weight:800;margin-top:4px;color:${color};">${val}</div>
  </div>`;
  const points = enriched.map(row => {
    const pnl = Number(row.signal?.realPnl)||0;
    const delta = Number(row.signal?.executionDelta)||0;
    const x = Math.max(62, Math.min(658, xOf(pnl)));
    const y = Math.max(44, Math.min(235, yOf(row.edgeScore)));
    const r = 7 + Math.sqrt((Number(row.stats?.count)||0) / maxTrades) * 13;
    const state = row.edgeState || traderEdgeState(row);
    const color = state.tone === 'good' ? '#00c47a' : state.tone === 'neutral' ? '#3d9cf0' : state.tone === 'warn' ? '#f59e0b' : '#f03d3d';
    const deltaRing = delta < 0 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r+4).toFixed(1)}" fill="none" stroke="#f03d3d" stroke-width="1" stroke-dasharray="3 4" opacity="0.45"/>` : '';
    return `<g>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="0.20" stroke="${color}" stroke-width="1.4"/>
      ${deltaRing}
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"/>
      <text x="${x.toFixed(1)}" y="${(y-r-7).toFixed(1)}" text-anchor="middle" fill="#a8b8cc" font-size="10" font-family="monospace" font-weight="700">${dashSafe(row.name).slice(0,18)}</text>
    </g>`;
  }).join('');
  const tableRows = enriched.slice(0,8).map(row => {
    const state = row.edgeState;
    const delta = Number(row.signal?.executionDelta)||0;
    const meta = row.scoreMeta || traderScoreMeta(row);
    return `<tr>
      <td><strong>${dashSafe(row.name)}</strong></td>
      <td>${meta.signalScore}</td>
      <td>${meta.capture == null ? '-' : meta.capture + '%'}</td>
      <td style="color:${meta.sample.label === 'Insuficiente' ? 'var(--amber)' : 'var(--t2)'};">${meta.sample.label}</td>
      <td class="${delta>=0?'pnl-pos':'pnl-neg'}">${dashMoney(delta)}</td>
      <td><span style="display:inline-flex;padding:3px 7px;border-radius:4px;background:rgba(255,255,255,0.04);color:${state.color};font-family:var(--mono);font-size:9px;font-weight:800;">${state.label}</span></td>
    </tr>`;
  }).join('');
  return `<div class="card" style="padding:16px;margin-bottom:12px;">
    <div class="fxb" style="gap:12px;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div class="sec-label" style="margin-bottom:5px;">Trader Signal Dashboard ${infoDot('Separa calidad de senal del trader de tu ejecucion. El color del punto representa calidad de senal: verde prioridad, azul normal, ambar muestra/reducir, rojo observacion. El anillo rojo punteado solo marca captura negativa, no mala senal.')}</div>
        <div style="font-size:11px;color:var(--t2);font-family:var(--mono);">Prioriza traders por calidad de senal, dejando la ejecucion como lectura separada.</div>
      </div>
    </div>
    <div class="g4" style="margin-bottom:12px;">
      ${mini('Mejor senal', topSignal, topSignal?.signal?.signalPnl, (topSignal?.signal?.signalPnl||0)>=0?'pnl-pos':'pnl-neg')}
      ${mini('Mejor real', topReal, topReal?.signal?.realPnl, (topReal?.signal?.realPnl||0)>=0?'pnl-pos':'pnl-neg')}
      ${miniText('Mejor Signal Score', topScore, topScore ? topScore.edgeScore : '-', topScore?.edgeState?.color || 'var(--accent)')}
      ${miniText('Mejor captura', topCapture, topCapture?.scoreMeta?.capture == null ? '-' : topCapture.scoreMeta.capture + '%', 'var(--accent)')}
    </div>
    <div class="trader-edge-layout">
      <div style="background:var(--bg3);border-radius:var(--r);padding:10px;min-height:280px;overflow:hidden;">
        <svg viewBox="0 0 720 270" style="width:100%;height:270px;display:block;">
          <line x1="360" y1="34" x2="360" y2="240" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
          <line x1="48" y1="226" x2="672" y2="226" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
          <line x1="48" y1="140" x2="672" y2="140" stroke="rgba(255,255,255,.055)" stroke-width="1"/>
          <text x="48" y="24" fill="#6a7888" font-size="10" font-family="monospace">SIGNAL SCORE</text>
          <text x="580" y="258" fill="#6a7888" font-size="10" font-family="monospace">PNL REAL +</text>
          <text x="48" y="258" fill="#6a7888" font-size="10" font-family="monospace">PNL REAL -</text>
          ${points}
        </svg>
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;background:var(--bg3);border-radius:var(--r);">
        <table class="tbl" style="min-width:460px;">
          <thead><tr><th>Trader</th><th>Signal</th><th>Captura</th><th>Muestra</th><th>Delta</th><th>Estado</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}
function renderProfessionalDashboard(closed) {
  const metricsEl = document.getElementById('dashProMetrics');
  const tablesEl = document.getElementById('dashProTables');
  if (!metricsEl || !tablesEl) return;
  if (!closed.length) {
    metricsEl.innerHTML = '';
    tablesEl.innerHTML = '';
    return;
  }
  const s = dashStatsOf(closed);
  const sig = signalStatsOf(closed);
  const best = closed.reduce((b,t)=>dashPnl(t)>dashPnl(b)?t:b, closed[0]);
  const worst = closed.reduce((w,t)=>dashPnl(t)<dashPnl(w)?t:w, closed[0]);
  metricsEl.innerHTML = [
    {l:'PnL total',v:dashMoney(s.pnl),cls:s.pnl>=0?'green':'red',sub:`${s.count} trades cerrados`},
    {l:'Signal PnL',v:dashMoney(sig.signalPnl),cls:sig.signalPnl>=0?'green':'red',sub:'Plan original del trader'},
    {l:'Execution delta',v:dashMoney(sig.executionDelta),cls:sig.executionDelta>=0?'green':'red',sub:'Real - Signal'},
    {l:'Win rate',v:Math.round(s.winRate*100)+'%',cls:s.winRate>=0.5?'green':'red',sub:`${s.wins} wins / ${s.losses} losses`},
    {l:'Profit factor',v:s.profitFactor===Infinity?'INF':s.profitFactor.toFixed(2),cls:s.profitFactor>=1?'green':'red',sub:'Ganancias / perdidas'},
    {l:'Expectancy',v:dashMoney(s.expectancy),cls:s.expectancy>=0?'green':'red',sub:'Promedio por trade'},
    {l:'Max drawdown',v:'-$'+fmt(s.maxDd),cls:'red',sub:'Caida maxima acumulada'},
    {l:'Avg win / loss',v:`+$${fmt(s.avgWin)} / -$${fmt(Math.abs(s.avgLoss))}`,cls:s.avgWin>Math.abs(s.avgLoss)?'green':'red'},
    {l:'R promedio',v:(s.avgR>=0?'+':'')+s.avgR.toFixed(2)+'R',cls:s.avgR>=0?'green':'red',sub:'Solo trades con SL'},
    {l:'Sharpe simple',v:s.sharpe.toFixed(2),cls:s.sharpe>=0?'green':'red',sub:`Best ${best?.ticker||'-'} / Worst ${worst?.ticker||'-'}`},
  ].map(dashMetricCard).join('');

  const traderRows = dashGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').slice(0,8);
  const tickerRows = dashGroupStats(closed, t => (t.ticker || 'Sin ticker').toUpperCase()).slice(0,8);
  const allSignalRows = signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader');
  const signalRows = allSignalRows.slice(0,8);
  const table = (title, rows) => `<div class="card" style="padding:0;overflow:hidden;">
    <div class="sec-label" style="padding:14px 14px 0;">${title}</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table class="tbl" style="min-width:560px;">
        <thead><tr><th>Nombre</th><th>Trades</th><th>PnL</th><th>WR</th><th>PF</th><th>Expectancy</th></tr></thead>
        <tbody>${rows.length?rows.map(dashProfessionalRow).join(''):`<tr><td colspan="6" style="color:var(--t3);">Sin datos suficientes</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
  const signalTable = `<div class="card" style="padding:0;overflow:hidden;margin-bottom:12px;">
    <div class="sec-label" style="padding:14px 14px 0;">Signal vs Real por trader ${infoDot('Compara el resultado estimado del plan original del trader contra tu resultado real. Delta positivo = tu gestion sumo valor; delta negativo = capturaste menos que el plan.')}</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table class="tbl" style="min-width:620px;">
        <thead><tr><th>Trader</th><th>Trades</th><th>Signal PnL</th><th>Real PnL</th><th>Delta</th><th>Lectura</th></tr></thead>
        <tbody>${signalRows.length?signalRows.map(row=>{
          const delta = row.signal.executionDelta;
          const label = Math.abs(delta) < 1 ? 'Neutral' : delta > 0 ? 'Tu gestion suma' : 'Se pierde edge';
          return `<tr>
            <td><strong>${dashSafe(row.name)}</strong></td>
            <td>${row.stats.count}</td>
            <td class="${row.signal.signalPnl>=0?'pnl-pos':'pnl-neg'}">${dashMoney(row.signal.signalPnl)}</td>
            <td class="${row.signal.realPnl>=0?'pnl-pos':'pnl-neg'}">${dashMoney(row.signal.realPnl)}</td>
            <td class="${delta>=0?'pnl-pos':'pnl-neg'}">${dashMoney(delta)}</td>
            <td style="color:var(--t2);">${label}</td>
          </tr>`;
        }).join(''):`<tr><td colspan="6" style="color:var(--t3);">Sin datos suficientes</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
  tablesEl.innerHTML = `${renderTraderEdgeVisual(allSignalRows)}${signalTable}<div class="g2">${table('Ranking por trader', traderRows)}${table('Ranking por activo', tickerRows)}</div>`;
}

const dashPlannedR = t => {
  const entry = Number(t?.entry) || 0;
  const sl = Number(t?.sl) || 0;
  const tp = Number(t?.tp1 || t?.tp2 || t?.tp3) || 0;
  if (!entry || !sl || !tp || entry === sl) return 0;
  return Math.abs((tp - entry) / (entry - sl));
};
function tradeQualityOf(t, globalStats) {
  let score = 60;
  const tags = [];
  const good = [];
  const mauexTags = Array.isArray(t?.mauexTags) ? t.mauexTags : [];
  const manualGood = Array.isArray(t?.goodTags) ? t.goodTags : [];
  const manualErrors = Array.isArray(t?.errorTags) ? t.errorTags : [];
  const pnl = dashPnl(t);
  const notes = [t?.notes, t?.closeNotes].filter(Boolean).join(' ');
  const notesLower = notes.toLowerCase();
  const hasSL = Number(t?.sl) > 0;
  const hasTP = ['tp1','tp2','tp3'].some(k => Number(t?.[k]) > 0);
  const lev = Number(t?.leverage) || 1;
  const rr = dashPlannedR(t);

  if (hasSL) { score += 12; good.push('Con SL'); }
  else { score -= 18; tags.push('Sin SL'); }

  if (hasTP) { score += 8; good.push('Con TP'); }
  else { score -= 6; tags.push('Sin TP'); }

  if (rr >= 2) { score += 12; good.push('Buen RR'); }
  else if (rr >= 1) score += 5;
  else if (hasSL && hasTP) { score -= 8; tags.push('RR flojo'); }

  if (notes.trim().length >= 30) score += 8;
  else if (notes.trim().length < 8) { score -= 10; tags.push('Sin notas'); }

  if (lev > 20) { score -= 18; tags.push('Over leverage'); }
  else if (lev > 10) { score -= 9; tags.push('Leverage alto'); }

  if (pnl > 0) score += 6;
  if (pnl < 0) score -= 6;

  const avgLossAbs = Math.abs(globalStats?.avgLoss || 0);
  if (pnl < 0 && avgLossAbs && Math.abs(pnl) > avgLossAbs * 1.6) {
    score -= 14;
    tags.push('Loss grande');
  }

  const reason = String(t?.closeReason || t?.reason || '').toLowerCase();
  if (/tp|take profit/.test(reason)) { score += 8; good.push('Respeto TP'); }
  if (/sl|stop/.test(reason) && hasSL) good.push('Respeto SL');

  if (/fomo/.test(notesLower)) { score -= 12; tags.push('FOMO'); }
  if (/revenge|venganza/.test(notesLower)) { score -= 14; tags.push('Revenge trade'); }
  if (/miedo|fear|panico|panic/.test(notesLower)) { score -= 10; tags.push('Cierre emocional'); }
  if (/temprano|early/.test(notesLower)) { score -= 8; tags.push('Closed early'); }

  mauexTags.forEach(tag => { if (!tags.includes(tag)) tags.push(tag); });
  manualErrors.forEach(tag => { if (!tags.includes(tag)) tags.push(tag); });
  manualGood.forEach(tag => { if (!good.includes(tag)) good.push(tag); });
  score += Math.min(18, manualGood.length * 4);
  score -= Math.min(28, manualErrors.length * 5);
  if (manualGood.includes('Respete plan')) score += 6;
  if (manualGood.includes('Cerre por invalidacion')) score += 4;
  if (manualErrors.includes('No respete SL')) score -= 12;
  if (manualErrors.includes('Revenge trade')) score -= 12;
  if (manualErrors.includes('FOMO')) score -= 10;
  if (manualErrors.includes('Sobreapalancamiento')) score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tags:[...new Set(tags)], good:[...new Set(good)], rr };
}
function renderQualityDashboard(closed) {
  const el = document.getElementById('dashQuality');
  if (!el) return;
  if (!closed.length) { el.innerHTML = ''; return; }
  const stats = dashStatsOf(closed);
  const scored = closed.map(t => ({ trade:t, quality:tradeQualityOf(t, stats) })).sort((a,b)=>b.quality.score-a.quality.score);
  const avgScore = Math.round(scored.reduce((s,x)=>s+x.quality.score,0) / scored.length);
  const tagCounts = {};
  scored.forEach(x => x.quality.tags.forEach(tag => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }));
  const repeated = Object.keys(tagCounts).sort((a,b)=>tagCounts[b]-tagCounts[a]).slice(0,7);
  const best = scored.slice(0,5);
  const watch = [...scored].sort((a,b)=>a.quality.score-b.quality.score).slice(0,5);
  const badge = (text, tone) => {
    const color = tone === 'good' ? 'var(--accent)' : 'var(--amber)';
    const bg = tone === 'good' ? 'rgba(0,196,122,0.13)' : 'rgba(245,158,11,0.13)';
    return `<span style="display:inline-flex;align-items:center;padding:3px 7px;border-radius:4px;background:${bg};color:${color};font-family:var(--mono);font-size:9px;font-weight:700;">${dashSafe(text)}</span>`;
  };
  const scoreColor = s => s >= 75 ? 'var(--accent)' : s >= 55 ? 'var(--amber)' : 'var(--red)';
  const tradeLine = x => `<div style="display:grid;grid-template-columns:44px 1fr 70px;gap:10px;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border);">
    <div style="font-family:var(--mono);font-size:17px;font-weight:800;color:${scoreColor(x.quality.score)};">${x.quality.score}</div>
    <div style="min-width:0;">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <strong style="font-family:var(--mono);font-size:11px;">${dashSafe(x.trade.ticker || '-')}</strong>
        <span class="badge ${x.trade.dir==='long'?'bl':x.trade.dir==='short'?'bs':'bsp'}">${String(x.trade.dir||'').toUpperCase()}</span>
        <span style="font-size:10px;color:var(--t3);">${dashSafe(x.trade.traderName || x.trade.exchange || '')}</span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">${(x.quality.tags.length?x.quality.tags:x.quality.good).slice(0,3).map(tag=>badge(tag, x.quality.tags.length?'warn':'good')).join('')}</div>
    </div>
    <div class="${dashPnl(x.trade)>=0?'pnl-pos':'pnl-neg'}" style="font-family:var(--mono);font-size:11px;text-align:right;">${dashMoney(dashPnl(x.trade))}</div>
  </div>`;

  el.innerHTML = `<div class="card" style="padding:16px;position:relative;">
    ${infoDot('Analiza tus trades cerrados y estima la calidad de ejecucion. No reemplaza tu criterio: sirve para detectar patrones repetidos de riesgo, notas incompletas, RR bajo o leverage excesivo.')}
    <div class="fxb" style="gap:12px;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div class="sec-label" style="margin-bottom:5px;">Calidad de ejecucion</div>
        <div style="font-size:11px;color:var(--t2);font-family:var(--mono);">Score automatico 0-100 basado en gestion de riesgo, RR, notas, leverage y resultado.</div>
      </div>
      <div style="text-align:right;padding-right:20px;">
        <div style="font-size:28px;font-family:var(--mono);font-weight:800;color:${scoreColor(avgScore)};">${avgScore}</div>
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);">score promedio</div>
      </div>
    </div>
    <div class="g3">
      <div>
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;display:flex;gap:6px;align-items:center;">ERRORES REPETIDOS ${infoDot('Tags negativos que aparecen con mas frecuencia en el historial, por ejemplo Sin SL, Sin notas u Over leverage. El numero de la derecha indica cuantas veces aparece.')}</div>
        ${repeated.length ? repeated.map(tag => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border);">
          <span>${badge(tag, 'warn')}</span>
          <span style="font-family:var(--mono);font-size:12px;color:var(--t1);">${tagCounts[tag]}</span>
        </div>`).join('') : `<div style="color:var(--t3);font-size:11px;">Sin patrones negativos detectados.</div>`}
      </div>
      <div>
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;display:flex;gap:6px;align-items:center;">MEJORES EJECUCIONES ${infoDot('Trades con mayor score de ejecucion. El numero grande es el score 0-100; a la derecha se muestra el PnL del trade.')}</div>
        ${best.map(tradeLine).join('')}
      </div>
      <div>
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;display:flex;gap:6px;align-items:center;">A REVISAR ${infoDot('Trades con menor score. Sirven para encontrar operaciones donde hubo poco plan, falta de SL/TP, notas incompletas o perdida grande.')}</div>
        ${watch.map(tradeLine).join('')}
      </div>
    </div>
  </div>`;
}

function renderDashboard() {
  const G      = window.G; if(!G) return;
  const all    = G.trades();
  const closed = all.filter(t=>t.status==='closed');
  const active = all.filter(t=>t.status==='active');
  const wins   = closed.filter(t=>(t.pnl||0)>0);
  const totPnl = closed.reduce((s,t)=>s+(t.pnl||0),0);
  const now    = new Date();
  const mPnl   = closed.filter(t=>t.closeDate).filter(t=>{ const d=new Date(t.closeDate); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); }).reduce((s,t)=>s+(t.pnl||0),0);
  const best   = closed.reduce((b,t)=>(t.pnl||0)>(b.pnl||0)?t:b,{pnl:0});
  const worst  = closed.reduce((w,t)=>(t.pnl||0)<(w.pnl||0)?t:w,{pnl:0});

  document.getElementById('dashDate').textContent = now.toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dashMetrics').innerHTML=[
    {l:'Trades cerrados',v:String(closed.length),sub:`${active.length} activos`},
    {l:'Win rate',v:closed.length?Math.round(wins.length/closed.length*100)+'%':'—',cls:closed.length&&wins.length/closed.length>=.5?'green':'red'},
    {l:'PnL total',v:(totPnl>=0?'+':'')+'$'+fmt(Math.abs(totPnl)),cls:totPnl>=0?'green':'red'},
    {l:'PnL este mes',v:(mPnl>=0?'+':'')+'$'+fmt(Math.abs(mPnl)),cls:mPnl>=0?'green':'red'},
    {l:'Mejor trade',v:best.pnl?'+$'+fmt(best.pnl):'—',sub:best.ticker||'',cls:'green'},
    {l:'Peor trade',v:worst.pnl<0?'-$'+fmt(Math.abs(worst.pnl)):'—',sub:worst.ticker||'',cls:'red'},
    {l:'Traders seguidos',v:String([...new Set(all.map(t=>t.traderId).filter(Boolean))].length)},
    {l:'Activos operados',v:String([...new Set(all.map(t=>t.ticker).filter(Boolean))].length)},
  ].map(dashMetricCard).join('');

  // Charts
  drawPnlChart(closed); drawWRChart(closed); drawAssetsChart(all);
  fetchAndRenderLiquidity();
  renderProfessionalDashboard(closed);
  renderIntelligenceDashboard(closed, all);
  renderQualityDashboard(closed);
  // Render equity curve + stats + capital pie (same as historial)
  setTimeout(() => renderHistCharts(closed), 50);

  // If no liquidity cache yet, fetch balance directly and draw pie
  if (!_liquidityCache && PROXY_URL) {
    fetch(`${PROXY_URL}/balance?t=${Date.now()}`, { cache: 'no-store' }).then(r=>r.json()).then(d=>{
      if (d.balances) {
        _liquidityCache = d;
        window._liquidityCache = d;
        if (window._drawCapitalPie) window._drawCapitalPie();
      }
    }).catch(()=>{});
  }

  // Active positions mini-list with live PnL total
  let liveTot=0, hasPx=false;
  active.forEach(t=>{ const p=G.getPrice(t.ticker,t.dir); if(p==null) return; hasPx=true; liveTot+=Math.round((t.posSize/t.entry)*(t.entry-p)*(t.dir==='short'?1:-1)*100)/100; });
  const liveRisk = active.reduce((s,t)=>s+openRiskOf(t),0);
  const posHtml = active.length ? `
    ${hasPx?`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0 10px;border-bottom:1px solid var(--border);margin-bottom:4px;">
      <span style="font-size:9px;color:var(--t3);font-family:var(--mono);">PNL TOTAL EN VIVO</span>
      <span style="font-family:var(--mono);font-size:14px;font-weight:600;" class="${liveTot>=0?'pnl-pos':'pnl-neg'}">${liveTot>=0?'+':'-'}$${fmt(Math.abs(liveTot))}</span>
      <span style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-left:12px;">RIESGO</span>
      <span style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--red);">$${fmt(liveRisk)}</span>
    </div>`:''}
    ${active.slice(0,5).map(t=>{
    const p = G.getPrice(t.ticker, t.dir);
    const pnl = p!=null ? Math.round((t.posSize/t.entry)*(t.entry-p)*(t.dir==='short'?1:-1)*100)/100 : null;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border);">
      <div class="fx" style="gap:6px;"><span style="font-family:var(--mono);font-weight:600;font-size:12px;">${t.ticker}</span> <span class="badge ${t.dir==='long'?'bl':t.dir==='short'?'bs':'bsp'}">${t.dir.toUpperCase()}${(t.leverage||1)>1?' x'+(t.leverage||1):''}</span></div>
      <div class="${pnl==null?'':pnl>=0?'pnl-pos':'pnl-neg'}" style="font-family:var(--mono);font-size:11px;">${pnl!=null?(pnl>=0?'+':'-')+'$'+fmt(Math.abs(pnl)):'—'}</div>
    </div>`;
  }).join('')}` : `<div class="empty"><div class="empty-icon">◻</div><div class="empty-text">Sin posiciones activas</div></div>`;
  document.getElementById('dashActivePos').innerHTML = posHtml;
}

function drawPnlChart(closed) {
  const canvas = document.getElementById('chartPnl'); if(!canvas) return;
  const months = {};
  closed.filter(t=>t.closeDate).forEach(t=>{ const d=new Date(t.closeDate); const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); months[k]=(months[k]||0)+(t.pnl||0); });
  const sorted = Object.keys(months).sort().slice(-12);
  const vals   = sorted.map(k=>months[k]);
  if(chPnl){chPnl.destroy();chPnl=null;}
  if(!sorted.length){canvas.style.display='none';return;}
  canvas.style.display='';
  chPnl = new Chart(canvas,{type:'bar',data:{labels:sorted.map(k=>{const[y,m]=k.split('-');return new Date(y,m-1).toLocaleDateString('es',{month:'short',year:'2-digit'});}),datasets:[{data:vals,backgroundColor:vals.map(v=>v>=0?'rgba(0,196,122,0.7)':'rgba(240,61,61,0.7)'),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#6a7888',font:{size:9}},grid:{display:false}},y:{ticks:{color:'#6a7888',font:{size:9},callback:v=>'$'+Math.round(v)},grid:{color:'rgba(128,128,128,0.08)'}}}}});
}

function drawWRChart(closed) {
  const canvas = document.getElementById('chartWR'); if(!canvas) return;
  const tMap = {};
  closed.forEach(t=>{ if(!t.traderName) return; if(!tMap[t.traderName]) tMap[t.traderName]={w:0,n:0}; tMap[t.traderName].n++; if((t.pnl||0)>0) tMap[t.traderName].w++; });
  const names = Object.keys(tMap);
  if(chWR){chWR.destroy();chWR=null;}
  if(!names.length){canvas.style.display='none';return;}
  canvas.style.display='';
  chWR = new Chart(canvas,{type:'bar',data:{labels:names,datasets:[{data:names.map(n=>Math.round(tMap[n].w/tMap[n].n*100)),backgroundColor:'rgba(61,156,240,0.7)',borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{max:100,ticks:{color:'#6a7888',font:{size:9},callback:v=>v+'%'},grid:{color:'rgba(128,128,128,0.08)'}},y:{ticks:{color:'#a8b8cc',font:{size:10}},grid:{display:false}}}}});
}

function drawAssetsChart(all) {
  const canvas = document.getElementById('chartAssets'); if(!canvas) return;
  const tMap = {};
  all.forEach(t=>{ if(!t.ticker||t.ticker==='undefined') return; tMap[t.ticker]=(tMap[t.ticker]||0)+1; });
  const sorted = Object.entries(tMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(chA){chA.destroy();chA=null;}
  if(!sorted.length){canvas.style.display='none';return;}
  canvas.style.display='';
  const colors=['rgba(0,196,122,0.8)','rgba(61,156,240,0.8)','rgba(240,160,48,0.8)','rgba(240,61,61,0.8)','rgba(176,96,255,0.8)','rgba(0,229,255,0.8)','rgba(255,60,120,0.8)','rgba(136,135,128,0.8)'];
  chA = new Chart(canvas,{type:'doughnut',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>v),backgroundColor:colors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#a8b8cc',font:{size:10},boxWidth:10,padding:8}}}}});
}

// ── Watchlist ──────────────────────────────────────────────────────────────
function readInvalidationFields(prefix) {
  const note = document.getElementById(prefix+'InvNote')?.value?.trim() || '';
  return [1,2].map(i => {
    const price = parseFloat(document.getElementById(prefix+'Inv'+i)?.value) || 0;
    const side = document.getElementById(prefix+'Inv'+i+'Side')?.value || 'up';
    return price > 0 ? { key:'inv'+i, label:'Inv '+i, price, side, note } : null;
  }).filter(Boolean);
}

function tradeInvalidations(t) {
  const list = Array.isArray(t?.invalidations) ? t.invalidations : [];
  return list.map((x,i) => ({
    key: x.key || 'inv'+(i+1),
    label: x.label || 'Inv '+(i+1),
    price: Number(x.price || 0),
    side: x.side === 'down' ? 'down' : 'up',
    note: x.note || '',
  })).filter(x => x.price > 0).slice(0, 2);
}

function invalidationHit(inv, price) {
  return inv.side === 'down' ? price <= inv.price : price >= inv.price;
}

function invalidationSignature(inv) {
  return inv ? [Number(inv.price)||0, inv.side || 'up', inv.note || ''].join('|') : '';
}

async function resetInvalidationAlertsIfChanged(id, before=[], after=[]) {
  const byKey = list => Object.fromEntries((list||[]).map(x => [x.key, x]));
  const oldMap = byKey(before);
  const newMap = byKey(after);
  for (const key of ['inv1','inv2']) {
    if (invalidationSignature(oldMap[key]) !== invalidationSignature(newMap[key])) {
      await clearAlertLevel(id, key);
    }
  }
}

function invalidationNotesHtml(t) {
  const touched = tradeInvalidations(t).filter(inv => hasAlert(t.id, inv.key));
  if (!touched.length) return '';
  return `<div style="font-size:11px;color:#9bdcff;padding:6px 12px;background:rgba(56,189,248,0.08);border-bottom:0.5px solid rgba(56,189,248,0.25);font-family:var(--mono);">
    ${touched.map(inv => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span><strong>${dashSafe(inv.label)} tocada:</strong> ${dashSafe(inv.note || 'Invalidacion')}</span>
        <button onclick="window.clearInvalidationAlertAndRender('${t.id}','${inv.key}')" title="Cancelar invalidacion"
          style="width:22px;height:22px;border-radius:50%;border:0.5px solid rgba(56,189,248,0.35);background:rgba(56,189,248,0.08);color:#9bdcff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1;flex-shrink:0;">×</button>
      </div>`).join('')}
  </div>`;
}

// ---- AI Risk Engine + Performance Intelligence ----
function baseTickerSymbol(ticker) {
  return String(ticker || '').trim().toUpperCase().replace(/[-_/ ]?(USDT|USDC|BUSD|USD|PERP)$/,'');
}

function assetRiskMultiplier(ticker) {
  const sym = baseTickerSymbol(ticker);
  if (!sym) return { mult:0.45, label:'Sin ticker', tier:'unknown' };
  if (sym === 'BTC') return { mult:1, label:'BTC core', tier:'core' };
  if (sym === 'ETH') return { mult:.8, label:'ETH core', tier:'core' };
  if (['GLD','IAUM','PSLV','SILVER','GOLD','OIL','USO','SLV'].includes(sym)) return { mult:.7, label:'Commodity / ETF', tier:'defensive' };
  if (['SOL','BNB','XRP','LINK','AAVE','DOGE','ADA','AVAX','DOT','LTC','XMR'].includes(sym)) return { mult:.5, label:'Large cap alt', tier:'large-alt' };
  if (['HYPE','CAKE','ONDO','TAO','NEAR','UNI','ATOM','POL','MATIC'].includes(sym)) return { mult:.35, label:'Altcoin media', tier:'mid-alt' };
  return { mult:.25, label:'Activo chico / sin clasificar', tier:'small-alt' };
}

function traderRiskRow(traderId, traderName) {
  const closed = (window.G?.trades?.() || []).filter(t => t.status === 'closed');
  const name = traderName || (window.G?.traders?.() || []).find(t => t.id === traderId)?.name || '';
  if (!name && !traderId) return null;
  const rows = signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader');
  return rows.find(r => r.name === name || r.name === traderId) || null;
}

function riskSuggestionForInput(input = {}) {
  const ticker = input.ticker || document.getElementById('cTicker')?.value || '';
  const traderId = input.traderId || document.getElementById('cTrader')?.value || '';
  const traderName = input.traderName || (window.G?.traders?.() || []).find(t => t.id === traderId)?.name || '';
  const dir = input.dir || calcState.dir || 'long';
  const leverage = Math.max(1, Number(input.leverage || calcState.lev || userPrefs?.lev || 1) || 1);
  const baseRisk = Math.max(10, Number(input.baseRisk || document.getElementById('cRisk')?.value || userPrefs?.risk || 200) || 200);
  const entry = Number(input.entry ?? document.getElementById('cEntry')?.value) || 0;
  const sl = Number(input.sl ?? document.getElementById('cSL')?.value) || 0;
  const tp1 = Number(input.tp1 ?? document.getElementById('cTP1')?.value) || 0;
  const tp2 = Number(input.tp2 ?? document.getElementById('cTP2')?.value) || 0;
  const tp3 = Number(input.tp3 ?? document.getElementById('cTP3')?.value) || 0;
  const hasSL = sl > 0;
  const row = traderRiskRow(traderId, traderName);
  const confidence = row ? traderSignalScore(row) : 50;
  const state = row ? traderEdgeState(row) : { label:'Sin historial', color:'var(--t3)', tone:'neutral' };
  const asset = assetRiskMultiplier(ticker);
  const traderMult = confidence >= 78 ? 1 : confidence >= 62 ? .75 : confidence >= 45 ? .45 : .2;
  let executionMult = 1;
  const warnings = [];
  if (!row) warnings.push('Trader sin historial suficiente en MAUex.');
  if (!ticker) warnings.push('Falta ticker para ajustar el riesgo por activo.');
  if (!hasSL && dir !== 'spot') { executionMult *= .2; warnings.push('Sin SL: MAUex reduce fuerte el riesgo sugerido.'); }
  if (hasSL && entry && [tp1,tp2,tp3].every(tp => !tp)) { executionMult *= .65; warnings.push('Sin TP cargado: menor calidad de plan.'); }
  if (asset.mult <= .35 && leverage > 7 && dir !== 'spot') { executionMult *= .45; warnings.push('Altcoin + leverage alto concentra perdidas historicas.'); }
  if (leverage > 20 && dir !== 'spot') { executionMult *= .55; warnings.push('Leverage muy alto para una senal discrecional.'); }

  const capByAsset = asset.mult >= .8 ? 15 : asset.mult >= .5 ? 8 : asset.mult >= .35 ? 5 : 3;
  const capByTrader = confidence >= 75 ? capByAsset : confidence >= 55 ? Math.min(capByAsset, 7) : Math.min(capByAsset, 4);
  const finalRisk = Math.max(0, Math.round(baseRisk * traderMult * asset.mult * executionMult));
  const suggestedRisk = finalRisk < 10 ? 10 : finalRisk;
  const severity = confidence < 45 || executionMult < .5 ? 'red' : confidence >= 75 && executionMult >= .8 ? 'green' : 'amber';
  return {
    ticker: baseTickerSymbol(ticker),
    traderName: traderName || 'Sin trader',
    confidence,
    state,
    asset,
    baseRisk,
    suggestedRisk,
    leverageCap: dir === 'spot' ? 1 : capByTrader,
    warnings,
    severity,
    traderMult,
    executionMult,
  };
}
window.riskSuggestionForInput = riskSuggestionForInput;

function renderRiskSuggestionPanel() {
  const el = document.getElementById('riskSuggestionPanel');
  if (!el) return;
  const s = riskSuggestionForInput();
  window._lastRiskSuggestion = s;
  const color = s.severity === 'green' ? 'var(--accent)' : s.severity === 'red' ? 'var(--red)' : 'var(--amber)';
  const confidence10 = Math.max(1, Math.min(10, Math.round((Number(s.confidence) || 0) / 10)));
  const riskFormulaInfo = 'Riesgo sugerido = riesgo base x factor trader x factor activo x factor ejecucion. Factor trader usa Signal Score, que mide calidad de senal del trader y ajusta por cantidad de trades. No castiga fuerte al trader por tu Execution Delta; eso se muestra aparte como captura del edge. Factor activo: BTC 1, ETH 0.8, commodities/ETF 0.7, large caps 0.5, alts medias 0.35, activos chicos 0.25. Factor ejecucion baja si no hay SL, no hay TP, leverage alto o altcoin con leverage alto.';
  const warnHtml = s.warnings.length
    ? `<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;">${s.warnings.slice(0,3).map(w=>`<span style="font-size:9px;font-family:var(--mono);color:var(--amber);background:rgba(245,158,11,.12);padding:3px 6px;border-radius:4px;">${dashSafe(w)}</span>`).join('')}</div>`
    : `<div style="margin-top:8px;font-size:10px;color:var(--t2);font-family:var(--mono);">Sin alertas fuertes para esta combinacion.</div>`;
  el.innerHTML = `
    <div class="sec-label" style="display:flex;align-items:center;gap:6px;">Riesgo sugerido ${infoDot(riskFormulaInfo)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
      <div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;">Sugerido</div>
        <div style="font-family:var(--mono);font-size:24px;font-weight:800;color:${color};">$${fmt(s.suggestedRisk)}</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--t3);font-family:var(--mono);text-transform:uppercase;">Confianza</div>
        <div style="font-family:var(--mono);font-size:24px;font-weight:800;color:${s.state.color};">${confidence10}<span style="font-size:11px;color:var(--t3);">/10</span></div>
      </div>
      <div style="font-size:10px;color:var(--t2);font-family:var(--mono);">Trader<br><strong style="color:var(--t1);">${dashSafe(s.traderName)}</strong></div>
      <div style="font-size:10px;color:var(--t2);font-family:var(--mono);">Leverage max<br><strong style="color:var(--t1);">${s.leverageCap}x</strong></div>
    </div>
    <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-top:8px;">${dashSafe(s.asset.label)} x${s.asset.mult}</div>
    ${warnHtml}
    <button class="btn sm" style="width:100%;margin-top:10px;" onclick="window.applySuggestedRisk()">Usar riesgo sugerido</button>
  `;
}

window.applySuggestedRisk = () => {
  const s = window._lastRiskSuggestion || riskSuggestionForInput();
  const riskEl = document.getElementById('cRisk');
  if (riskEl && s?.suggestedRisk) {
    riskEl.value = s.suggestedRisk;
    compute();
  }
};

function portfolioExposureStats(all) {
  const open = all.filter(t => ['active','pending','watchlist'].includes(t.status));
  const out = { open, long:0, short:0, spot:0, risk:0, byExchange:{}, byTicker:{}, byTrader:{}, byStatus:{} };
  open.forEach(t => {
    const capital = dashboardTradeCapital(t);
    const risk = t.status === 'active' ? openRiskOf(t) : capital;
    const dir = String(t.dir || '').toLowerCase();
    if (dir === 'short') out.short += capital;
    else if (dir === 'spot') out.spot += capital;
    else out.long += capital;
    out.risk += t.status === 'active' ? openRiskOf(t) : 0;
    const add = (obj, key, val) => { key = key || 'Sin dato'; obj[key] = (obj[key] || 0) + val; };
    add(out.byExchange, String(t.exchange || 'MANUAL').toUpperCase(), capital);
    add(out.byTicker, baseTickerSymbol(t.ticker) || 'Sin ticker', capital);
    add(out.byTrader, t.traderName || 'Sin trader', capital);
    add(out.byStatus, t.status, capital);
  });
  out.total = out.long + out.short + out.spot;
  out.net = out.long + out.spot - out.short;
  return out;
}
window.portfolioExposureStats = portfolioExposureStats;

function topExposureRows(obj, limit=6) {
  return Object.entries(obj || {}).sort((a,b)=>b[1]-a[1]).slice(0, limit);
}

function renderExposureBars(obj, total) {
  return topExposureRows(obj, 6).map(([k,v]) => `
    <div style="margin-bottom:8px;">
      <div class="fxb" style="font-size:10px;font-family:var(--mono);color:var(--t2);"><span>${dashSafe(k)}</span><span>$${fmt(v)}</span></div>
      <div style="height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${Math.min(100, total ? v/total*100 : 0)}%;background:var(--blue);"></div></div>
    </div>`).join('') || `<div style="font-size:11px;color:var(--t3);">Sin exposicion abierta.</div>`;
}

function aiReviewStatus(closed) {
  const raw = localStorage.getItem('mauex_last_ai_review');
  let last = null;
  try { last = raw ? JSON.parse(raw) : null; } catch(e) {}
  const lastAt = last?.at ? new Date(last.at) : null;
  const days = lastAt && !Number.isNaN(lastAt.getTime()) ? Math.floor((Date.now() - lastAt.getTime()) / 86400000) : null;
  const tradesSince = Math.max(0, closed.length - (Number(last?.closedCount) || 0));
  const stats = dashStatsOf(closed);
  const needsReview = days == null || days >= 7 || tradesSince >= 15 || stats.profitFactor < 1 || stats.maxDd > Math.abs(stats.avgLoss || 0) * 3;
  const reason = days == null ? 'Nunca marcaste una revision IA.' :
    tradesSince >= 15 ? `${tradesSince} trades cerrados desde la ultima revision.` :
    days >= 7 ? `${days} dias desde la ultima revision.` :
    stats.profitFactor < 1 ? 'Profit factor debajo de 1.' :
    stats.maxDd > Math.abs(stats.avgLoss || 0) * 3 ? 'Drawdown alto contra perdida promedio.' :
    'Revision al dia.';
  return { lastAt, days, tradesSince, needsReview, reason };
}
window.aiReviewStatus = aiReviewStatus;

window.markAiReviewDone = () => {
  const closedCount = (window.G?.trades?.() || []).filter(t => t.status === 'closed').length;
  localStorage.setItem('mauex_last_ai_review', JSON.stringify({ at:new Date().toISOString(), closedCount }));
  renderDashboard();
  toast('Revision IA marcada como realizada.');
};

function smartAlertsForDashboard(all, closed) {
  const alerts = [];
  const stats = dashStatsOf(closed);
  const exposure = portfolioExposureStats(all);
  const active = all.filter(t => t.status === 'active');
  const noSl = active.filter(t => !Number(t.sl));
  if (noSl.length) alerts.push({ tone:'red', title:'Posiciones sin SL', text:`${noSl.length} posicion(es) activas sin SL. MAUex toma el margen como riesgo.` });
  if (exposure.total && Math.abs(exposure.net) / exposure.total > .65) alerts.push({ tone:'amber', title:'Exposicion direccional alta', text:`El portfolio abierto esta ${exposure.net >= 0 ? 'net long' : 'net short'} en ${Math.round(Math.abs(exposure.net)/exposure.total*100)}%.` });
  const topEx = topExposureRows(exposure.byExchange, 1)[0];
  if (topEx && exposure.total && topEx[1] / exposure.total > .55) alerts.push({ tone:'amber', title:'Concentracion por exchange', text:`${topEx[0]} concentra ${Math.round(topEx[1]/exposure.total*100)}% del capital abierto.` });
  signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').forEach(r => {
    if (r.stats.count >= 3 && traderSignalScore(r) < 45) {
      const ss = signalPerformanceStatsOf(r.trades);
      alerts.push({ tone:'red', title:'Trader en observacion', text:`${r.name} tiene Signal Score ${traderSignalScore(r)} y Signal PF ${ss.profitFactor === Infinity ? 'INF' : ss.profitFactor.toFixed(2)}.` });
    }
    if (r.stats.count >= 3 && r.signal.executionDelta < -Math.max(50, Math.abs(r.signal.signalPnl) * .2)) alerts.push({ tone:'amber', title:'Edge no capturado', text:`Con ${r.name}, tu delta vs senal es ${dashMoney(r.signal.executionDelta)}.` });
  });
  dashGroupStats(closed, t => baseTickerSymbol(t.ticker)).forEach(r => {
    const last = [...r.trades].sort((a,b)=>(new Date(dashClosedAt(b))-new Date(dashClosedAt(a)))).slice(0,4);
    if (last.length >= 3 && last.every(t => dashPnl(t) < 0)) alerts.push({ tone:'red', title:'Racha negativa por activo', text:`${r.name} tiene ${last.length} cierres negativos recientes.` });
  });
  if (stats.profitFactor && stats.profitFactor < 1) alerts.push({ tone:'red', title:'PF debajo de 1', text:'El historial cerrado esta perdiendo mas de lo que gana.' });
  return alerts.slice(0, 8);
}
window.smartAlertsForDashboard = smartAlertsForDashboard;

function capitalAllocationRows(closed) {
  const rows = signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').filter(r => r.stats.count >= 1);
  const weighted = rows.map(r => {
    const score = traderSignalScore(r);
    const state = traderEdgeState(r);
    const sample = sampleConfidenceOf(r.stats.count);
    const captureScore = executionCaptureScore(r);
    const weight = state.label === 'Prioridad' ? 1.6 : state.label === 'Normal' ? 1.1 : state.label === 'Reducir' ? .55 : state.label === 'Muestra baja' ? .35 : .15;
    return { ...r, score, captureScore, sample, state, weight };
  });
  const totalW = weighted.reduce((s,r)=>s+r.weight,0) || 1;
  return weighted.sort((a,b)=>b.weight-a.weight || b.score-a.score).map(r => ({ ...r, allocationPct: Math.round(r.weight / totalW * 100) }));
}
window.capitalAllocationRows = capitalAllocationRows;

function signalBacktestRows(closed) {
  const rows = signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader');
  return rows.map(r => {
    const tp = r.trades.filter(t => /^tp/i.test(String(t.closeLevel || t.closeReason || ''))).length;
    const sl = r.trades.filter(t => /sl|stop/i.test(String(t.closeLevel || t.closeReason || ''))).length;
    const manual = Math.max(0, r.stats.count - tp - sl);
    const capture = r.signal.signalPnl > 0 ? Math.round(r.signal.realPnl / r.signal.signalPnl * 100) : null;
    return { ...r, tp, sl, manual, capture };
  }).sort((a,b)=>b.signal.signalPnl-a.signal.signalPnl);
}
window.signalBacktestRows = signalBacktestRows;

function renderIntelligenceDashboard(closed, all) {
  const el = document.getElementById('dashIntelligence');
  if (!el) return;
  const exposure = portfolioExposureStats(all);
  const alerts = smartAlertsForDashboard(all, closed);
  const review = aiReviewStatus(closed);
  const alloc = capitalAllocationRows(closed).slice(0, 8);
  const backtest = signalBacktestRows(closed).slice(0, 8);
  const riskRows = signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').slice(0,4).map(r => {
    const st = traderEdgeState(r);
    const sample = riskSuggestionForInput({ ticker:'BTC', traderName:r.name, dir:'long', leverage:5, baseRisk:userPrefs?.risk || 200, entry:100, sl:95, tp1:110 });
    return `<tr><td><strong>${dashSafe(r.name)}</strong></td><td>${traderSignalScore(r)}</td><td style="color:${st.color};">${st.label}</td><td>$${fmt(sample.suggestedRisk)}</td><td>${sample.leverageCap}x</td></tr>`;
  }).join('');
  const alertHtml = alerts.length ? alerts.map(a => `
    <div style="padding:9px 0;border-bottom:0.5px solid var(--border);">
      <div style="font-family:var(--mono);font-size:11px;font-weight:800;color:${a.tone === 'red' ? 'var(--red)' : 'var(--amber)'};">${dashSafe(a.title)}</div>
      <div style="font-size:11px;color:var(--t2);margin-top:3px;">${dashSafe(a.text)}</div>
    </div>`).join('') : `<div style="font-size:11px;color:var(--t3);">Sin alertas criticas ahora.</div>`;
  const allocRows = alloc.map(r => `
    <tr><td><strong>${dashSafe(r.name)}</strong></td><td>${r.score}</td><td style="color:${r.state.color};">${r.state.label}</td><td>${r.allocationPct}%</td><td>${r.sample.label}</td></tr>
  `).join('');
  const backRows = backtest.map(r => `
    <tr><td><strong>${dashSafe(r.name)}</strong></td><td>${r.stats.count}</td><td class="${r.signal.signalPnl>=0?'pnl-pos':'pnl-neg'}">${dashMoney(r.signal.signalPnl)}</td><td class="${r.signal.realPnl>=0?'pnl-pos':'pnl-neg'}">${dashMoney(r.signal.realPnl)}</td><td>${r.capture == null ? '-' : r.capture + '%'}</td><td>${r.tp}/${r.sl}/${r.manual}</td></tr>
  `).join('');
  el.innerHTML = `
    <div class="card" style="padding:16px;margin-bottom:12px;">
      <div class="sec-label" style="margin-bottom:10px;">Risk Suggestion Engine ${infoDot('Sugiere riesgo y leverage maximo usando Signal Score del trader, activo, leverage y calidad del setup. El Signal Score mide calidad de senal; la captura de ejecucion se muestra aparte.')}</div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table class="tbl" style="min-width:520px;">
          <thead><tr><th>Trader</th><th>Signal</th><th>Estado</th><th>Riesgo BTC base</th><th>Lev max</th></tr></thead>
          <tbody>${riskRows || `<tr><td colspan="5" style="color:var(--t3);">Falta historial cerrado para calibrar traders.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="g2" style="margin-bottom:12px;">
      <div class="card" style="padding:16px;">
        <div class="sec-label" style="margin-bottom:10px;">Portfolio Exposure Engine ${infoDot('Resume capital abierto por direccion, exchange y ticker para que veas concentracion antes de sumar otra senal.')}</div>
        <div class="g4" style="margin-bottom:12px;">
          ${dashMetricCard({l:'Long + Spot',v:'$'+fmt(exposure.long+exposure.spot),cls:'green',info:'Capital abierto long y spot.'})}
          ${dashMetricCard({l:'Short',v:'$'+fmt(exposure.short),cls:'red',info:'Capital abierto en shorts.'})}
          ${dashMetricCard({l:'Net exposure',v:(exposure.net>=0?'+':'-')+'$'+fmt(Math.abs(exposure.net)),cls:exposure.net>=0?'green':'red',info:'Long + spot menos shorts.'})}
          ${dashMetricCard({l:'Riesgo abierto',v:'$'+fmt(exposure.risk),cls:'red',info:'Riesgo estimado por SL o margen si no hay SL.'})}
        </div>
        <div class="g2">
          <div><div class="sec-label">Por exchange</div>${renderExposureBars(exposure.byExchange, exposure.total)}</div>
          <div><div class="sec-label">Por ticker</div>${renderExposureBars(exposure.byTicker, exposure.total)}</div>
        </div>
      </div>
      <div class="card" style="padding:16px;">
        <div class="sec-label" style="margin-bottom:10px;">Alertas inteligentes ${infoDot('Cruza riesgo, concentracion, traders y rachas para avisarte cuando algo merece atencion antes de operar mas.')}</div>
        ${alertHtml}
      </div>
    </div>
    <div class="g2" style="margin-bottom:12px;">
      <div class="card" style="padding:16px;">
        <div class="fxb" style="align-items:flex-start;gap:12px;margin-bottom:10px;">
          <div>
            <div class="sec-label">AI Review System ${infoDot('Te recuerda cuando conviene exportar el dashboard y pedir una revision IA de rendimiento, riesgo y ejecucion.')}</div>
            <div style="font-size:11px;color:var(--t2);font-family:var(--mono);margin-top:5px;">${dashSafe(review.reason)}</div>
          </div>
          <div style="font-family:var(--mono);font-size:22px;font-weight:800;color:${review.needsReview?'var(--amber)':'var(--accent)'};">${review.needsReview?'Revisar':'OK'}</div>
        </div>
        <div class="g2" style="gap:8px;margin-bottom:10px;">
          ${dashMetricCard({l:'Dias',v:review.days == null ? '-' : String(review.days),info:'Dias desde la ultima revision IA marcada.'})}
          ${dashMetricCard({l:'Trades desde review',v:String(review.tradesSince),info:'Trades cerrados desde la ultima revision IA.'})}
        </div>
        <button class="btn sm" onclick="window.markAiReviewDone()">Marcar revision hecha</button>
      </div>
      <div class="card" style="padding:16px;">
        <div class="sec-label" style="margin-bottom:10px;">Asignacion de capital por trader ${infoDot('Allocation basada principalmente en Signal Score del trader y ajustada por cantidad de trades. La ejecucion personal no hunde al trader; se analiza aparte como captura del edge.')}</div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <table class="tbl" style="min-width:480px;"><thead><tr><th>Trader</th><th>Signal</th><th>Estado</th><th>Allocation</th><th>Muestra</th></tr></thead><tbody>${allocRows || `<tr><td colspan="5" style="color:var(--t3);">Sin datos suficientes.</td></tr>`}</tbody></table>
        </div>
      </div>
    </div>
    <div class="card" style="padding:16px;">
      <div class="sec-label" style="margin-bottom:10px;">Backtesting de se&ntilde;ales ${infoDot('Compara lo que hubieran dado las senales segun el plan original contra lo que capturaste realmente.')}</div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table class="tbl" style="min-width:650px;">
          <thead><tr><th>Trader</th><th>Trades</th><th>Signal</th><th>Real</th><th>Captura</th><th>TP/SL/Manual</th></tr></thead>
          <tbody>${backRows || `<tr><td colspan="6" style="color:var(--t3);">Sin historial cerrado para backtest.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function positionUnitsLabel(t, size, entry) {
  const qty = Number(size || 0) && Number(entry || 0) ? Number(size) / Number(entry) : 0;
  if (!qty) return '—';
  const ticker = String(t?.ticker || t?.symbol || '')
    .replace(/USDT|BUSD|USD$/,'')
    .toUpperCase() || 'u';
  return `${fmtQty(qty)} ${ticker}`;
}

function buildPriceBar(t, currentPrice) {
  if (!t?.entry) return '';
  const dir   = t.dir || 'long';
  const entry = t.entry;
  const sl    = t.sl   || null;
  const liq   = t.liquidation || null;
  const tp1   = t.tp1  || null;
  const tp2   = t.tp2  || null;
  const tp3   = t.tp3  || null;
  const cur   = currentPrice || null;
  const invs  = tradeInvalidations(t);

  // All price points for range calculation
  const allPrices = [entry, sl, liq, tp1, tp2, tp3, cur, ...invs.map(x=>x.price)].filter(p => p && p > 0);
  if (allPrices.length < 2) return '';
  let minP = Math.min(...allPrices) * 0.998;
  let maxP = Math.max(...allPrices) * 1.002;
  const isBreakeven = sl && Math.abs(sl - entry) / entry < 0.001;
  if (!isBreakeven && (maxP - minP) / entry < 0.02) { minP = entry * 0.99; maxP = entry * 1.01; }
  const range = maxP - minP;
  if (range <= 0) return '';

  const pct  = p => ((p - minP) / range * 100).toFixed(4);
  const pctN = p => parseFloat(pct(p));

  // Markers
  const markers = [
    ...(liq ? [{v:liq, c:'var(--amber)', l:'Liq', w:1}] : []),
    ...(sl && !isBreakeven ? [{v:sl, c:'var(--red)', l:'SL', w:2}] : []),
    {v:entry, c: isBreakeven ? 'var(--red)' : '#ffffff', l: isBreakeven ? 'Entry = SL' : 'Entry', w:2},
    ...(tp1 ? [{v:tp1, c:'#4ade80', l:'TP1', w:1}] : []),
    ...(tp2 ? [{v:tp2, c:'#22c55e', l:'TP2', w:1}] : []),
    ...(tp3 ? [{v:tp3, c:'#16a34a', l:'TP3', w:1}] : []),
    ...invs.map((x,i)=>({v:x.price, c:'#38bdf8', l:x.label || `Inv ${i+1}`, w:1})),
    ...(cur ? [{v:cur, c:'#e040fb', l:'', w:3, isCur:true}] : []),
  ];

  // ── Color zones ────────────────────────────────────────────────────────────
  // 1. Red zone: entry ↔ SL (only when SL exists and not breakeven)
  const hasRedZone = sl && !isBreakeven;
  const redFrom = hasRedZone ? Math.min(entry, sl) : null;
  const redTo   = hasRedZone ? Math.max(entry, sl) : null;

  // 2. Amber zone: SL ↔ Liq (when both SL and Liq exist)
  //    OR entry ↔ Liq (when no SL — full danger zone)
  const hasAmberZone = liq != null;
  const amberFrom = hasAmberZone ? (sl && !isBreakeven ? Math.min(sl, liq) : Math.min(entry, liq)) : null;
  const amberTo   = hasAmberZone ? (sl && !isBreakeven ? Math.max(sl, liq) : Math.max(entry, liq)) : null;
  // Warning emoji position: midpoint of amber zone (only when no SL)
  const warnNoSL  = !sl && liq;
  const warnMidPct = warnNoSL ? (pctN(amberFrom) + pctN(amberTo)) / 2 : null;

  // 3. Green zones: entry → TPs (progressive opacity, NO clamping)
  const greenZones = [];
  if (tp1) greenZones.push({from: entry, to: tp1, op: 0.3});
  if (tp2) greenZones.push({from: tp1||entry, to: tp2, op: 0.5});
  if (tp3) greenZones.push({from: tp2||tp1||entry, to: tp3, op: 0.72});

  // For short: flip green zones so they go from entry toward lower TPs
  if (dir === 'short') {
    greenZones.forEach(z => { const tmp = z.from; z.from = z.to; z.to = tmp; });
  }

  const zoneDiv = (fromP, toP, color, opacity) => {
    const l = Math.min(pctN(fromP), pctN(toP));
    const r = Math.max(pctN(fromP), pctN(toP));
    const w = r - l;
    if (w <= 0) return '';
    return `<div style="position:absolute;left:${l}%;width:${w}%;height:6px;background:${color};opacity:${opacity};border-radius:3px;"></div>`;
  };
  const touched = level => !!(t?.id && hasAlert(t.id, level));
  const memorySegment = (fromP, toP, color, opacity=.82) => {
    if (!fromP || !toP) return '';
    const l = Math.min(pctN(fromP), pctN(toP));
    const r = Math.max(pctN(fromP), pctN(toP));
    const w = r - l;
    if (w <= 0) return '';
    return `<div style="position:absolute;left:${l}%;width:${w}%;height:100%;background:${color};opacity:${opacity};border-radius:inherit;box-shadow:0 0 10px ${color};"></div>`;
  };

  // ── Collision detection — ALL labels including current price ─────────────
  const BAR_PX  = 500;
  const CHAR_PX = 7;
  const labelW  = (text) => text.length * CHAR_PX / BAR_PX * 100;

  // Build unified label list including current price
  const allLabels = [];

  // Static markers (SL, Entry, TPs, Liq)
  markers.filter(m => !m.isCur).forEach(m => {
    const priceStr = `$${fmtPx(m.v)}`;
    const w = Math.max(labelW(m.l), labelW(priceStr));
    allLabels.push({ isCur: false, m, left: pctN(m.v), w, topRow: true, priceStr });
  });

  // Current price marker
  const curMarker = markers.find(m => m.isCur);
  if (curMarker) {
    const curStr = `$${fmtPx(curMarker.v)}`;
    allLabels.push({ isCur: true, left: pctN(curMarker.v), w: labelW(curStr), topRow: true, curStr, m: curMarker });
  }

  // Sort by position
  allLabels.sort((a, b) => a.left - b.left);

  // Resolve collisions — alternate top/bottom
  for (let i = 1; i < allLabels.length; i++) {
    const prev = allLabels[i - 1];
    const curr = allLabels[i];
    const prevRight = prev.left + prev.w / 2;
    const currLeft  = curr.left - curr.w / 2;
    if (currLeft < prevRight + 0.5) curr.topRow = !prev.topRow;
  }

  // Determine first and last positions for edge alignment
  const firstLeft = allLabels.length ? allLabels[0].left : 50;
  const lastLeft  = allLabels.length ? allLabels[allLabels.length - 1].left : 50;

  const renderLabel = (obj) => {
    const { left, topRow, isCur } = obj;
    const isFirst = left === firstLeft;
    const isLast  = left === lastLeft;

    // Edge alignment: first label anchors left, last anchors right, rest centered
    let labelAlign, priceAlign;
    if (isFirst) {
      labelAlign = `left:0;`;
      priceAlign = `left:0;`;
    } else if (isLast) {
      labelAlign = `right:0;`;
      priceAlign = `right:0;`;
    } else {
      labelAlign = `left:50%;transform:translateX(-50%);`;
      priceAlign = `left:50%;transform:translateX(-50%);`;
    }

    const topName  = topRow ? 'top:-17px'    : 'bottom:-32px';
    const topPrice = topRow ? 'top:-28px'    : 'bottom:-43px';

    if (isCur) {
      const nameRow = topRow ? 'top:-16px' : 'bottom:-30px';
      return `<div style="position:absolute;left:${left}%;top:50%;transform:translate(-50%,-50%);width:0;height:0;">
        <div style="position:absolute;${nameRow};${labelAlign}font-size:9px;font-family:var(--mono);color:#e040fb;white-space:nowrap;font-weight:700;">${obj.curStr}</div>
      </div>`;
    } else {
      const { m, priceStr } = obj;
      const nameColor  = m.isCur ? '#e040fb' : m.c;
      const priceColor = m.c;
      const nameRow  = topRow ? 'top:-16px'  : 'bottom:-30px';
      const priceRow = topRow ? 'top:-27px'  : 'bottom:-41px';
      return `<div style="position:absolute;left:${left}%;top:50%;transform:translate(-50%,-50%);width:0;height:0;">
        <div style="position:absolute;${nameRow};${labelAlign}font-size:9px;font-family:var(--mono);color:${m.c};white-space:nowrap;">${m.l}</div>
        <div style="position:absolute;${priceRow};${priceAlign}font-size:9px;font-family:var(--mono);color:${m.c};white-space:nowrap;">${priceStr}</div>
      </div>`;
    }
  };

  // ── Build dot+gradient meter ─────────────────────────────────────────────
  // Zones as gradients
  const zones = [];
  const memoryZones = [];

  // Liq → SL: amber gradient
  if (liq && sl && !isBreakeven) {
    const l = Math.min(pctN(liq), pctN(sl));
    const r = Math.max(pctN(liq), pctN(sl));
    if (r > l) zones.push(`<div style="position:absolute;left:${l}%;width:${r-l}%;height:100%;background:linear-gradient(${dir==='short'?'270deg':'90deg'},rgba(245,158,11,0.08),rgba(245,158,11,0.22));border-radius:inherit;"></div>`);
  }
  // Liq → Entry: amber (no SL)
  if (liq && (!sl || isBreakeven)) {
    const l = Math.min(pctN(liq), pctN(entry));
    const r = Math.max(pctN(liq), pctN(entry));
    if (r > l) zones.push(`<div style="position:absolute;left:${l}%;width:${r-l}%;height:100%;background:linear-gradient(90deg,rgba(245,158,11,0.07),rgba(245,158,11,0.2));border-radius:inherit;"></div>`);
  }
  // SL → Entry: red gradient
  if (sl && !isBreakeven) {
    const l = Math.min(pctN(sl), pctN(entry));
    const r = Math.max(pctN(sl), pctN(entry));
    if (r > l) zones.push(`<div style="position:absolute;left:${l}%;width:${r-l}%;height:100%;background:linear-gradient(${dir==='short'?'270deg':'90deg'},rgba(224,82,82,0.08),rgba(224,82,82,0.22));border-radius:inherit;"></div>`);
  }
  // Entry → TPs: green gradient
  const lastTp = tp3||tp2||tp1;
  if (lastTp) {
    const l = Math.min(pctN(entry), pctN(lastTp));
    const r = Math.max(pctN(entry), pctN(lastTp));
    if (r > l) zones.push(`<div style="position:absolute;left:${l}%;width:${r-l}%;height:100%;background:linear-gradient(${dir==='short'?'270deg':'90deg'},rgba(74,222,128,0.06),rgba(22,163,74,0.2));border-radius:inherit;"></div>`);
  }

  if (touched('tp1') && tp1) memoryZones.push(memorySegment(entry, tp1, '#22c55e'));
  if (touched('tp2') && tp2) memoryZones.push(memorySegment(tp1 || entry, tp2, '#22c55e'));
  if (touched('tp3') && tp3) memoryZones.push(memorySegment(tp2 || tp1 || entry, tp3, '#16a34a'));
  if (touched('sl') && sl && !isBreakeven) memoryZones.push(memorySegment(entry, sl, '#e05252', .86));
  if (touched('liq') && liq) memoryZones.push(memorySegment(entry, liq, '#f59e0b', .86));
  invs.forEach(inv => {
    if (touched(inv.key)) memoryZones.push(memorySegment(entry, inv.price, '#38bdf8', .8));
  });

  // Dots
  const dotHtml = (leftPct, color, size, glow='') =>
    `<div style="position:absolute;left:${leftPct}%;top:50%;transform:translate(-50%,-50%);width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid var(--bg2);${glow}flex-shrink:0;"></div>`;

  const dots = [
    liq    ? dotHtml(pctN(liq),   '#f59e0b', 10) : '',
    sl&&!isBreakeven ? dotHtml(pctN(sl), '#e05252', 11) : '',
    cur    ? dotHtml(pctN(cur),   '#e040fb', 14, 'box-shadow:0 0 10px rgba(224,64,251,0.7);') : '',
    entry  ? dotHtml(pctN(entry), '#ffffff', 11) : '',
    ...invs.map(x => dotHtml(pctN(x.price), '#38bdf8', 10, 'box-shadow:0 0 8px rgba(56,189,248,0.45);')),
    tp1    ? dotHtml(pctN(tp1),   '#4ade80', 10) : '',
    tp2    ? dotHtml(pctN(tp2),   '#22c55e', 10) : '',
    tp3    ? dotHtml(pctN(tp3),   '#16a34a', 10) : '',
  ].join('');

  // Labels with collision detection
  const allMarkersHtml = allLabels.map(renderLabel).join('');

  return `
  <div style="position:relative;margin:20px 0 28px;">
    <div style="position:relative;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:visible;">
      ${zones.join('')}
      ${memoryZones.join('')}
      ${dots}
      ${allMarkersHtml}
      ${warnNoSL ? `<div style="position:absolute;left:${warnMidPct}%;transform:translateX(-50%);top:-22px;font-size:13px;line-height:1;" title="Sin Stop Loss">⚠️</div>` : ''}
    </div>
  </div>`;
}


// ── Exchange URL helper ────────────────────────────────────────────────────
function getExchangeUrl(exchange, ticker, dir) {
  const ex = (exchange||'').toUpperCase();
  const isSpot = dir === 'spot';
  const base = ticker ? ticker.replace(/USDT$/,'').replace(/_USDT$/,'') : '';
  const symUsdt = base + 'USDT';
  const symUnderscore = base + '_USDT'; // for MEXC commodities like USOIL_USDT

  if (ex === 'BINANCE') {
    return isSpot
      ? `https://www.binance.com/en/trade/${base}_USDT`
      : `https://www.binance.com/en/futures/${symUsdt}`;
  }
  if (ex === 'BYBIT') {
    return isSpot
      ? `https://www.bybit.com/en/trade/spot/${base}/USDT`
      : `https://www.bybit.com/trade/usdt/${symUsdt}`;
  }
  if (ex === 'OKX') {
    return isSpot
      ? `https://www.okx.com/trade-spot/${base.toLowerCase()}-usdt`
      : `https://www.okx.com/trade-swap/${base.toLowerCase()}-usdt-swap`;
  }
  if (ex === 'MEXC') {
    // MEXC commodities already have underscore format (USOIL_USDT)
    const mSym = ticker?.includes('_') ? ticker : symUnderscore;
    return isSpot
      ? `https://www.mexc.com/exchange/${mSym}`
      : `https://futures.mexc.com/exchange/${mSym}`;
  }
  if (ex === 'KUCOIN') {
    return isSpot
      ? `https://www.kucoin.com/trade/${base}-USDT`
      : `https://www.kucoin.com/futures/trade/${base}USDTM`;
  }
  if (ex === 'IBKR') {
    return base
      ? `https://www.interactivebrokers.com/en/trading/products-exchanges.php?symbol=${encodeURIComponent(base)}`
      : 'https://www.interactivebrokers.com/';
  }
  return null;
}

// ── Card minimize/maximize memory ──────────────────────────────────────────
function getCardState() {
  try { return JSON.parse(localStorage.getItem('mauex_card_state')||'{}'); } catch(e){ return {}; }
}
function setCardMinimized(id, minimized) {
  const s = getCardState(); s[id] = minimized;
  localStorage.setItem('mauex_card_state', JSON.stringify(s));
}
window.toggleCardMin = (id) => {
  const s = getCardState();
  setCardMinimized(id, !s[id]);
  renderPositions(); renderOrders(); renderWatchlist();
};

async function saveWatchlistOrder(ids) {
  if (!window._fb?.updateDoc || !window._fb?.doc || !window._fb?.db) return;
  await Promise.all(ids.map((id, index) => window._fb.updateDoc(
    window._fb.doc(window._fb.db, 'trades', id),
    { watchOrder: index + 1, updatedAt: new Date().toISOString() }
  )));
  (window.G?.trades?.() || []).forEach(t => {
    const index = ids.indexOf(t.id);
    if (index >= 0) t.watchOrder = index + 1;
  });
}

function attachWatchlistDrag() {
  const container = document.getElementById('watchCards');
  if (!container) return;
  let draggedId = null;

  container.querySelectorAll('[data-watch-card-id]').forEach(card => {
    card.addEventListener('dragstart', e => {
      draggedId = card.dataset.watchCardId;
      card.classList.add('watch-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('watch-dragging');
      draggedId = null;
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = container.querySelector('.watch-dragging');
      if (!dragging || dragging === card) return;
      const rect = card.getBoundingClientRect();
      const placeAfter = e.clientY > rect.top + rect.height / 2;
      container.insertBefore(dragging, placeAfter ? card.nextSibling : card);
    });
    card.addEventListener('drop', async e => {
      e.preventDefault();
      const ids = [...container.querySelectorAll('[data-watch-card-id]')].map(el => el.dataset.watchCardId);
      if (draggedId && ids.includes(draggedId)) {
        try {
          await saveWatchlistOrder(ids);
          toast('Orden de watchlist actualizado.');
        } catch(err) {
          toast('No pude guardar el orden: ' + err.message, 'error');
          renderWatchlist();
        }
      }
    });
  });
}

function renderWatchlist() {
  const G = window.G; if(!G) return;
  const items = G.trades()
    .filter(t=>t.status==='watchlist')
    .sort((a,b) => {
      const ao = Number(a.watchOrder || 0);
      const bo = Number(b.watchOrder || 0);
      if (ao || bo) return (ao || 999999) - (bo || 999999);
      return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0);
    });
  const container = document.getElementById('watchCards');
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><div class="empty-text">No hay setups en watchlist</div><div class="empty-sub">Agregá un setup desde la Calculadora</div></div>`;
    return;
  }
  if (typeof startLivePrices === 'function') setTimeout(startLivePrices, 100);

  const cardStates = getCardState();

  container.innerHTML = items.map(t => {
    const G = window.G;
    const sym = (t.ticker||'').replace(/USDT|BUSD|USD$/,'').toUpperCase();
    const currentPrice = G?.getPrice(sym, t.dir) || G?.getPrice(t.ticker, t.dir);
    const lev = t.leverage||1;
    const isSpot = t.dir === 'spot';
    const displaySize = effectiveTradeSize(t);
    const margin = t.dir==='spot' ? displaySize : displaySize/lev;
    const unitsLabel = positionUnitsLabel(t, displaySize, t.entry);
    const slDist = t.entry&&t.sl ? Math.abs(t.sl-t.entry)/t.entry*100 : 0;
    const sign = (t.dir==='short') ? -1 : 1;
    const contr = (displaySize||0)/(t.entry||1);
    const riskUsd = t.risk || (displaySize&&slDist ? displaySize*slDist/100 : null);
    const distToEntry = currentPrice&&t.entry ? ((t.entry-currentPrice)/currentPrice*100*sign) : null;
    const distColor = distToEntry==null?'var(--t3)':Math.abs(distToEntry)<1?'var(--accent)':Math.abs(distToEntry)<3?'var(--amber)':'var(--t2)';
    const tpPnlCalc = (tpPrice, pct) => {
      if(!tpPrice||!t.entry||!displaySize) return null;
      return Math.round(contr*(tpPrice-t.entry)*sign*(pct/100)*100)/100;
    };
    const rrRisk = t.risk || 0;
    const rrPnlTP1 = t.tp1&&t.entry&&displaySize ? Math.abs((t.tp1-t.entry)/t.entry*displaySize*(t.tp1pct||33)/100) : 0;
    const rr = rrRisk && rrPnlTP1 ? rrPnlTP1/rrRisk : (t.tp1&&t.entry&&t.sl ? Math.abs((t.tp1-t.entry)/(t.entry-t.sl)) : 0);
    const tps = [{l:'TP1',v:t.tp1,pct:t.tp1pct||33},{l:'TP2',v:t.tp2,pct:t.tp2pct||33},{l:'TP3',v:t.tp3,pct:t.tp3pct||34}].filter(x=>x.v);
    const wLiq = t.liquidation || estimatedLiquidationPrice(t);
    const fakeT = {...t, liquidation: t.liquidation||wLiq};
    const isMin = !!cardStates[t.id];
    const invalidAlert = getInvalidationAlert(t, currentPrice);
    const entryTouched = hasAlert(t.id, 'entry');
    const entryBadge = entryTouched ? alertBadge('entry', 'badge-alert-slow') : '';
    const watchCardClass = entryTouched ? 'hit-entry' : invalidAlert.cardClass;
    const watchBorderColor = entryTouched ? 'var(--amber)' : 'var(--red)';
    const dirBadge = dirBadgeColors(t.dir);
    const dirColor  = dirBadge.color;
    const dirBg     = dirBadge.bg;
    const dirBorder = dirBadge.border;
    const rrFor = (tp) => {
      if (!tp||!t.sl||!t.entry) return null;
      const reward = Math.abs(tp-t.entry), risk = Math.abs(t.sl-t.entry);
      return risk ? (reward/risk).toFixed(1) : null;
    };

    const collapseBtn = `<button onclick="window.toggleCardMin('${t.id}')"
      style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.35);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${isMin?'▼':'▲'}</button>`;

    const header = `
      <div style="padding:13px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--red);flex-shrink:0;"></div>
            <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--t1);">${t.ticker||'—'}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${dirBg};color:${dirColor};font-family:var(--mono);border:0.5px solid ${dirBorder};">${dirLevLabel(t)}</span>
            ${t.exchange?`<a href="${getExchangeUrl(t.exchange,t.ticker,t.dir)||'#'}" target="_blank" rel="noopener"
              style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2);text-decoration:none;">${t.exchange} ↗</a>`:''}
            ${t.traderName?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);">· ${t.traderName}</span>`:''}
            ${entryBadge}
            ${invalidAlert.badges?`<span style="display:inline-flex;gap:4px;">${invalidAlert.badges}</span>`:''}
            ${currentPrice&&distToEntry!=null?`<span style="font-size:10px;color:${distColor};font-family:var(--mono);">${distToEntry>=0?'▲':'▼'} ${Math.abs(distToEntry).toFixed(2)}% al entry</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div style="text-align:right;">
            <div style="font-size:14px;font-weight:600;font-family:var(--mono);color:var(--t1);" data-watchpx="${sym}" data-watchdir="${t.dir}">${currentPrice?'$'+fmtPx(currentPrice):'—'}</div>
            <div style="font-size:10px;color:var(--t3);font-family:var(--mono);">precio actual</div>
          </div>
          ${collapseBtn}
        </div>
      </div>`;

    if (isMin) {
      return `<div class="${watchCardClass}" data-watch-card-id="${t.id}" draggable="true" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${watchBorderColor};margin-bottom:8px;overflow:hidden;cursor:grab;">
        ${header}
        ${fakeT.entry&&(fakeT.sl||fakeT.tp1)?`<div style="padding:0 16px 14px;">${buildPriceBar(fakeT, currentPrice||0)}</div>`:''}
      </div>`;
    }

    return `<div class="${watchCardClass}" data-watch-card-id="${t.id}" draggable="true" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${watchBorderColor};margin-bottom:8px;overflow:hidden;cursor:grab;">
      ${header}

      ${fakeT.entry&&(fakeT.sl||fakeT.tp1) ? `<div style="padding:0 16px 16px;">${buildPriceBar(fakeT, currentPrice||0)}</div>` : ''}

      ${isSpot ? `
      <div style="display:grid;grid-template-columns:1fr 0.5px 1fr 0.5px 1fr 0.5px 1fr;border-top:0.5px solid var(--border2);border-bottom:0.5px solid var(--border2);">
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:${t.sl ? 'rgba(224,82,82,0.6)' : 'var(--blue)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${t.sl ? 'Riesgo a SL' : 'Capital expuesto'}</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:${t.sl ? 'var(--red)' : 'var(--blue)'};">${t.sl ? '-$'+fmt(riskUsd||0) : '$'+fmt(displaySize||0)}</div>
          <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">${t.sl && slDist ? slDist.toFixed(1)+'% entry' : 'spot sin liquidacion'}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Capital invertido</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(t.posSize||0)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Precio actual</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">${currentPrice ? '$'+fmtPx(currentPrice) : '-'}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Tamaño</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t2);">${unitsLabel}</div>
        </div>
      </div>` : `
      <div style="display:grid;grid-template-columns:1fr 0.5px 1fr 0.5px 1fr 0.5px 1fr;border-top:0.5px solid var(--border2);border-bottom:0.5px solid var(--border2);">
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:${t.sl ? 'rgba(224,82,82,0.6)' : 'var(--amber)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${t.sl ? 'SL Riesgo' : 'Riesgo en liq.'}</div>
          ${t.sl ? `
            <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--red);">−$${fmt(riskUsd||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">${slDist?slDist.toFixed(1)+'% entry':''}</div>
          ` : `
            <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--amber);">−$${fmt(margin||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">margen</div>
          `}
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Margen</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(margin)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Nominal</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(displaySize||0)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Tamaño</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t2);">${unitsLabel}</div>
        </div>
      </div>`}

      ${tps.length ? `
      <div style="display:grid;grid-template-columns:${tps.map(()=>'1fr').join(' ')};border-bottom:0.5px solid var(--border2);">
        ${tps.map((tp,i) => {
          const tpColors = ['#4ade80','#22c55e','#16a34a'];
          const tpColor  = tpColors[i] || '#4ade80';
          const tpBg     = ['rgba(74,222,128,0.03)','rgba(34,197,94,0.03)','rgba(22,163,74,0.03)'][i] || 'transparent';
          const distFromEntry = tp.v&&t.entry ? Math.abs((tp.v-t.entry)/t.entry*100) : null;
          const tpPnlAmt = displaySize&&t.entry ? Math.round(contr*(tp.v-t.entry)*(t.dir==='short'?-1:1)*(tp.pct/100)*100)/100 : null;
          const rr = rrFor(tp.v);
          return `<div style="padding:10px 14px;${i<tps.length-1?'border-right:0.5px solid var(--border2);':''}background:${tpBg};">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:8px;color:${tpColor};opacity:0.6;text-transform:uppercase;letter-spacing:.06em;">${tp.l} · ${tp.pct}%</span>
              ${rr?`<span style="font-size:9px;font-family:var(--mono);color:#22c55e;">${rr}:1</span>`:''}
            </div>
            <div style="font-size:14px;font-weight:600;font-family:var(--mono);color:${tpColor};">$${fmtPx(tp.v)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">
              ${distFromEntry!=null?`+${distFromEntry.toFixed(1)}%`:''} ${tpPnlAmt!=null?`· +$${fmt(tpPnlAmt)}`:''}
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${cleanAutoCloseNotes(t.notes)?`<div style="font-size:11px;color:var(--t2);padding:6px 12px;background:var(--bg3);border-bottom:0.5px solid var(--border2);">${cleanAutoCloseNotes(t.notes)}</div>`:''}
      ${invalidationNotesHtml(t)}

      <div style="display:grid;grid-template-columns:2fr 3fr 1fr 1fr;gap:8px;padding:10px 14px;background:rgba(0,0,0,0.15);">
        <select onchange="window.moveCardToStatus('${t.id}', this.value)"
          style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;">
          <option value="watchlist" selected>👁 Watchlist</option>
          <option value="pending">⏳ Órdenes</option>
          <option value="active">🟢 Posición</option>
        </select>
        <button style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;" onclick="openTradeInAnalysis('${t.id}')">📊 Analizar</button>
        <button style="background:var(--bg3);color:var(--t3);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="openEditTrade('${t.id}')">✎</button>
        <button style="background:rgba(224,82,82,0.08);color:var(--red);border:0.5px solid rgba(224,82,82,0.15);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="deleteTrade('${t.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
  attachWatchlistDrag();
}

// ── Positions ──────────────────────────────────────────────────────────────
// ── Alert state (persists in localStorage) ──────────────────────────────────
const ALERT_KEY = 'mauex_alerts';
function getAlerts() { try { return JSON.parse(localStorage.getItem(ALERT_KEY)||'{}'); } catch(e) { return {}; } }
function tradeForAlert(id) { return (window.G?.trades?.()||[]).find(x=>x.id===id); }
function cloudAlertOf(id, level) { return tradeForAlert(id)?.levelAlerts?.[level] || null; }
function alertPayload(level, meta={}) {
  return {
    level,
    hitAt: meta.hitAt || new Date().toISOString(),
    price: Number(meta.price || 0) || null,
    source: meta.source || 'live',
    confirmed: false,
  };
}
function rememberLocalAlert(id, level, payload) {
  const a = getAlerts();
  a[id] = a[id] || {};
  a[id][level] = payload?.hitAt || Date.now();
  localStorage.setItem(ALERT_KEY, JSON.stringify(a));
}
async function persistCloudAlert(id, level, payload) {
  try {
    const t = tradeForAlert(id);
    if (!t || !window._fb?.updateDoc || !window._getCU?.()) return;
    t.levelAlerts = { ...(t.levelAlerts||{}), [level]: payload };
    await window._fb.updateDoc(window._fb.doc(window._fb.db,'trades',id), {
      ['levelAlerts.'+level]: payload,
      levelAlertCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch(e) { console.warn('No pude guardar alerta en Firebase:', e.message); }
}
function setAlert(id, level, meta={}) {
  const existing = cloudAlertOf(id, level) || getAlerts()[id]?.[level];
  if (existing) return;
  const payload = alertPayload(level, meta);
  rememberLocalAlert(id, level, payload);
  persistCloudAlert(id, level, payload);
  const activePage = document.querySelector('.bnav-btn.active')?.dataset.page || '';
  if (sectionOfTrade(tradeForAlert(id)) === activePage) {
    const seen = navAlertSeen();
    seen[activePage] = Date.now();
    saveNavAlertSeen(seen);
  }
  updateNavAlertBadges?.();
}
window.setAlert = setAlert;
function clearAlerts(id) { const a=getAlerts(); delete a[id]; localStorage.setItem(ALERT_KEY, JSON.stringify(a)); }
async function clearAlertLevel(id, level) {
  const a = getAlerts();
  if (a[id]) {
    delete a[id][level];
    if (!Object.keys(a[id]).length) delete a[id];
    localStorage.setItem(ALERT_KEY, JSON.stringify(a));
  }
  const t = tradeForAlert(id);
  if (t?.levelAlerts) delete t.levelAlerts[level];
  try {
    if (window._fb?.updateDoc && window._fb?.deleteField) {
      await window._fb.updateDoc(window._fb.doc(window._fb.db,'trades',id), {
        ['levelAlerts.'+level]: window._fb.deleteField(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch(e) { console.warn('No pude limpiar alerta:', e.message); }
  updateNavAlertBadges?.();
}
window.clearInvalidationAlert = (id, level='inv1') => clearAlertLevel(id, level);
window.clearInvalidationAlertAndRender = async (id, level='inv1') => {
  await clearAlertLevel(id, level);
  renderWatchlist?.();
  renderOrders?.();
  renderPositions?.();
  renderMap?.();
};
function hasAlert(id, level) { return !!(cloudAlertOf(id, level) || getAlerts()[id]?.[level]); }
window.hasAlert = hasAlert;
const NAV_ALERT_SEEN_KEY = 'mauex_nav_alert_seen';
const NAV_ALERT_SECTIONS = {
  watchlist: ['entry','inv1','inv2'],
  orders: ['entry','inv1','inv2'],
  positions: ['sl','liq','tp1','tp2','tp3','inv1','inv2'],
};
function navAlertSeen() {
  try { return JSON.parse(localStorage.getItem(NAV_ALERT_SEEN_KEY) || '{}'); }
  catch(e) { return {}; }
}
function saveNavAlertSeen(seen) {
  localStorage.setItem(NAV_ALERT_SEEN_KEY, JSON.stringify(seen || {}));
}
function alertTimeOf(t, level) {
  const cloud = t?.levelAlerts?.[level];
  const local = getAlerts()[t?.id]?.[level];
  const raw = cloud?.hitAt || cloud?.confirmedAt || local;
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
function alertSeverityOf(level) {
  if (level === 'sl') return { key:'red', rank:4 };
  if (/^inv\d+$/.test(level)) return { key:'blue', rank:3 };
  if (level === 'entry' || level === 'liq') return { key:'amber', rank:2 };
  if (/^tp\d+$/.test(level)) return { key:'green', rank:1 };
  return { key:'amber', rank:0 };
}
function sectionOfTrade(t) {
  if (t?.status === 'watchlist') return 'watchlist';
  if (t?.status === 'pending') return 'orders';
  if (['active','zombie'].includes(t?.status)) return 'positions';
  return '';
}
function navAlertSummary() {
  const seen = navAlertSeen();
  const summary = {
    watchlist: { count:0, color:'amber', rank:0 },
    orders: { count:0, color:'amber', rank:0 },
    positions: { count:0, color:'green', rank:0 },
  };
  (window.G?.trades?.() || []).forEach(t => {
    const section = sectionOfTrade(t);
    const levels = NAV_ALERT_SECTIONS[section];
    if (!levels) return;
    let cardUnread = false;
    let cardRank = 0;
    let cardColor = 'amber';
    levels.forEach(level => {
      if (!hasAlert(t.id, level)) return;
      const hitAt = alertTimeOf(t, level) || Date.now();
      if (hitAt <= (Number(seen[section]) || 0)) return;
      cardUnread = true;
      const sev = alertSeverityOf(level);
      if (sev.rank > cardRank) { cardRank = sev.rank; cardColor = sev.key; }
    });
    if (!cardUnread) return;
    summary[section].count += 1;
    if (cardRank > summary[section].rank) {
      summary[section].rank = cardRank;
      summary[section].color = cardColor;
    }
  });
  return summary;
}
function updateNavAlertBadges() {
  const summary = navAlertSummary();
  Object.entries(summary).forEach(([page, data]) => {
    const btn = document.querySelector(`.bnav-btn[data-page="${page}"]`);
    if (!btn) return;
    let badge = btn.querySelector('.nav-alert-badge');
    if (!data.count) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-alert-badge';
      btn.appendChild(badge);
    }
    badge.textContent = data.count > 9 ? '9+' : String(data.count);
    badge.dataset.color = data.color;
  });
}
function markNavAlertsSeen(page) {
  if (!NAV_ALERT_SECTIONS[page]) {
    updateNavAlertBadges();
    return;
  }
  const seen = navAlertSeen();
  seen[page] = Date.now();
  saveNavAlertSeen(seen);
  updateNavAlertBadges();
}
window.updateNavAlertBadges = updateNavAlertBadges;
const EDIT_ALERT_LEVELS = [
  { level:'entry', label:'Entry' },
  { level:'sl', label:'SL' },
  { level:'liq', label:'Liq' },
  { level:'tp1', label:'TP1' },
  { level:'tp2', label:'TP2' },
  { level:'tp3', label:'TP3' },
  { level:'inv1', label:'Inv 1' },
  { level:'inv2', label:'Inv 2' },
];
function alertLevelHasPrice(t, level) {
  if (!t) return false;
  if (level === 'entry') return ['pending','watchlist'].includes(t.status) && !!t.entry;
  if (level === 'sl') return !!t.sl;
  if (level === 'liq') return !!t.liquidation;
  if (['tp1','tp2','tp3'].includes(level)) return !!t[level];
  if (['inv1','inv2'].includes(level)) return tradeInvalidations(t).some(inv => inv.key === level && inv.price);
  return false;
}
function editAlertLevelsFor(t) {
  if (!t?.id) return [];
  return EDIT_ALERT_LEVELS.filter(def => alertLevelHasPrice(t, def.level) || hasAlert(t.id, def.level));
}
function renderEditAlertState(t) {
  const panel = document.getElementById('eAlertStatePanel');
  const chips = document.getElementById('eAlertChips');
  if (!panel || !chips || !t?.id) return;
  const levels = editAlertLevelsFor(t);
  window._editAlertState = {};
  if (!levels.length) {
    panel.style.display = 'none';
    chips.innerHTML = '';
    return;
  }
  panel.style.display = '';
  chips.innerHTML = levels.map(def => {
    const checked = hasAlert(t.id, def.level);
    window._editAlertState[def.level] = checked;
    const color = checked ? 'var(--accent)' : 'var(--t3)';
    const bg = checked ? 'rgba(0,196,122,0.12)' : 'var(--bg3)';
    const border = checked ? 'rgba(0,196,122,0.45)' : 'var(--border2)';
    return `<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:6px;border:0.5px solid ${border};background:${bg};color:${color};font-family:var(--mono);font-size:10px;font-weight:700;cursor:pointer;">
      <input type="checkbox" ${checked?'checked':''} onchange="toggleEditAlertLevel('${def.level}', this.checked)" style="width:13px;height:13px;accent-color:#00c47a;">
      ${def.label}
    </label>`;
  }).join('');
}
window.toggleEditAlertLevel = (level, checked) => {
  window._editAlertState = window._editAlertState || {};
  window._editAlertState[level] = !!checked;
};
async function applyEditAlertState(id, updatedTrade) {
  const state = window._editAlertState || {};
  const levels = Object.keys(state);
  if (!id || !levels.length) return;
  const creates = {};
  for (const level of levels) {
    const before = hasAlert(id, level);
    const next = !!state[level];
    if (!next && before) {
      await clearAlertLevel(id, level);
    } else if (next && !before && alertLevelHasPrice(updatedTrade, level)) {
      const payload = alertPayload(level, { source:'manual_edit' });
      rememberLocalAlert(id, level, payload);
      if (updatedTrade) updatedTrade.levelAlerts = { ...(updatedTrade.levelAlerts||{}), [level]: payload };
      creates['levelAlerts.' + level] = payload;
    }
  }
  if (Object.keys(creates).length && window._fb?.updateDoc) {
    await window._fb.updateDoc(window._fb.doc(window._fb.db,'trades',id), firestoreSafeObject({
      ...creates,
      levelAlertCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }
}
function levelClosureOf(t, level, closedParts) {
  if (!t || !level) return null;
  const fromParent = t.levelClosures?.[level];
  if (fromParent) return fromParent;
  const fromAlert = t.levelAlerts?.[level];
  if (fromAlert?.confirmed) return fromAlert;
  const parts = closedParts || (typeof closedPartsForPosition === 'function' ? closedPartsForPosition(t.id) : []);
  const part = parts.find(x => x.closeLevel === level);
  if (!part) return null;
  return {
    closedAt: part.closeDate,
    closePrice: part.closePrice,
    closePctOriginal: part.closePctOriginal,
    pnl: part.pnl,
    posSize: part.posSize,
    reason: part.closeReason,
  };
}
function isLevelConfirmed(t, level, closedParts) { return !!levelClosureOf(t, level, closedParts); }
function cleanAutoCloseNotes(notes) {
  return String(notes || '').split(' · ').filter(p => !/^TP[123] cerrado [(][^)]* original[)] a [$]?/i.test(p.trim())).join(' · ');
}
async function syncLocalAlertsToCloud() {
  const local = getAlerts();
  const trackable = (window.G?.trades?.()||[]).filter(t => t.status === 'active' || t.status === 'pending' || t.status === 'watchlist');
  for (const t of trackable) {
    const invLevels = tradeInvalidations(t).map(x => x.key);
    const levels = ['pending','watchlist'].includes(t.status) ? ['entry', ...invLevels] : ['sl','tp1','tp2','tp3', ...invLevels];
    for (const level of levels) {
      if (!local[t.id]?.[level] || cloudAlertOf(t.id, level)) continue;
      const payload = alertPayload(level, { hitAt: typeof local[t.id][level] === 'string' ? local[t.id][level] : new Date().toISOString(), source:'local_migration' });
      await persistCloudAlert(t.id, level, payload);
    }
  }
}

// Build alert badge (icon + label)
function alertBadge(level, blinkClass) {
  const isSL = level === 'sl';
  const isEntry = level === 'entry';
  const isInv = /^inv\d+$/.test(level);
  const colors = { sl:'#e05252', liq:'#f59e0b', entry:'#f59e0b', inv1:'#38bdf8', inv2:'#38bdf8', tp1:'#4ade80', tp2:'#22c55e', tp3:'#16a34a' };
  const color  = colors[level] || '#4ade80';
  const icon   = isSL
    ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`
    : isEntry
    ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4" stroke="${color}" stroke-width="2"/><circle cx="6" cy="6" r="1.3" fill="${color}"/></svg>`
    : isInv
    ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1.5L10.5 10H1.5L6 1.5Z" stroke="${color}" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 4.4V6.8" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="8.6" r=".7" fill="${color}"/></svg>`
    : `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polyline points="1.5,6 4.5,9.5 10.5,2" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const label  = isEntry ? 'ENTRY TOCADO' : isInv ? 'INVALIDACION' : level === 'liq' ? 'LIQ TOCADA' : level.toUpperCase();
  return `<span class="${blinkClass}" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-family:var(--mono);padding:2px 7px;border-radius:4px;background:${color}22;color:${color};">${icon}${label}</span>`;
}

function getInvalidationAlert(t, price) {
  const hitBadges = [];
  tradeInvalidations(t).forEach(inv => {
    const key = inv.key || 'inv1';
    if (hasAlert(t.id, key)) {
      hitBadges.push(alertBadge(key, 'badge-alert-slow'));
      return;
    }
    if (price && invalidationHit(inv, price)) {
      setAlert(t.id, key, { price, source:'live' });
      hitBadges.push(alertBadge(key, 'badge-alert-slow'));
    }
  });
  return { cardClass: hitBadges.length ? 'hit-invalidation' : '', badges: hitBadges.join('') };
}

// Get proximity/hit alert info for a position
function getPositionAlert(t, price) {
  if (!price || !t.entry) return { cardClass:'', badges:'' };

  const closedParts = typeof closedPartsForPosition === 'function' ? closedPartsForPosition(t.id) : [];
  const badgeFor = level => alertBadge(level, isLevelConfirmed(t, level, closedParts) ? '' : 'badge-alert-slow');
  const hitBadges = [];
  const invAlert = getInvalidationAlert(t, price);
  if (invAlert.badges) hitBadges.push(invAlert.badges);

  ['sl','tp1','tp2','tp3'].forEach(level => {
    if (hasAlert(t.id, level)) hitBadges.push(badgeFor(level));
  });

  if (t.sl && !hasAlert(t.id,'sl')) {
    const hitSL = (t.dir==='short') ? price >= t.sl : price <= t.sl;
    if (hitSL) { setAlert(t.id,'sl'); hitBadges.push(badgeFor('sl')); }
  }
  if (!t.sl && t.liquidation && !hasAlert(t.id,'liq')) {
    const hitLiq = (t.dir==='short') ? price >= t.liquidation : price <= t.liquidation;
    if (hitLiq) { setAlert(t.id,'liq'); hitBadges.push(badgeFor('liq')); }
  }
  ['tp1','tp2','tp3'].forEach(k => {
    if (t[k] && !hasAlert(t.id,k)) {
      const hitTP = (t.dir==='short') ? price <= t[k] : price >= t[k];
      if (hitTP) { setAlert(t.id,k); hitBadges.push(badgeFor(k)); }
    }
  });

  const hasInv = tradeInvalidations(t).some(inv => hasAlert(t.id, inv.key || 'inv1'));
  const cardClass = hasAlert(t.id,'sl') ? 'hit-sl' : hasInv ? 'hit-invalidation' : hasAlert(t.id,'liq') ? 'hit-entry' : hitBadges.length ? 'hit-tp' : '';
  return { cardClass, badges: hitBadges.join('') };
}

function getLevelCheckWindow(t) {
  const now = Date.now();
  const last = Date.parse(t.levelAlertCheckedAt || '') || 0;
  const opened = Date.parse(t.createdAt || '') || 0;
  const fallback = now - 14 * 24 * 60 * 60 * 1000;
  const start = Math.max(opened || fallback, last || fallback, now - 60 * 24 * 60 * 60 * 1000);
  return { start, end: now };
}
function klineIntervalFor(ms) {
  const day = 24 * 60 * 60 * 1000;
  if (ms <= 2 * day) return '5m';
  if (ms <= 7 * day) return '15m';
  if (ms <= 30 * day) return '1h';
  return '4h';
}
async function fetchLevelCandles(t, start, end) {
  const sym = (t.ticker||'').replace(/USDT|BUSD|USD$/,'').toUpperCase();
  if (!sym) return [];
  const interval = klineIntervalFor(end - start);
  const symbol = sym + 'USDT';
  const isFutures = (t.dir||'long') !== 'spot';
  const base = isFutures ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
  const url = base + '?symbol=' + symbol + '&interval=' + interval + '&startTime=' + Math.floor(start) + '&endTime=' + Math.floor(end) + '&limit=1000';
  const r = await (window.proxyFetch ? window.proxyFetch(url) : fetch(url));
  if (!r.ok) throw new Error('HTTP '+r.status);
  const data = await r.json();
  if (!Array.isArray(data)) return [];
  return data.map(k=>({ time:k[0], high:Number(k[2]), low:Number(k[3]) })).filter(c=>c.high>0&&c.low>0);
}
function candleHitForLevel(t, level, value, candles) {
  const isLong = (t.dir||'long') !== 'short';
  const inv = /^inv\d+$/.test(level) ? tradeInvalidations(t).find(x => x.key === level) : null;
  for (const c of candles) {
    if (inv) {
      if (inv.side === 'down' ? c.low <= value : c.high >= value) return { hitAt:new Date(c.time).toISOString(), price:value };
      continue;
    }
    if (level === 'sl' || level === 'entry' || level === 'liq') {
      if (isLong ? c.low <= value : c.high >= value) return { hitAt:new Date(c.time).toISOString(), price:value };
    } else if (isLong ? c.high >= value : c.low <= value) {
      return { hitAt:new Date(c.time).toISOString(), price:value };
    }
  }
  return null;
}
window.checkMissedTradeLevels = async function checkMissedTradeLevels() {
  await syncLocalAlertsToCloud();
  const active = (window.G?.trades?.()||[]).filter(t => t.status === 'active' && t.entry && (t.sl || (!t.sl && t.liquidation) || t.tp1 || t.tp2 || t.tp3 || tradeInvalidations(t).length));
  const pendingOrders = (window.G?.trades?.()||[]).filter(t => t.status === 'pending' && t.entry && !hasAlert(t.id, 'entry'));
  const watchEntries = (window.G?.trades?.()||[]).filter(t => t.status === 'watchlist' && t.entry && (!hasAlert(t.id, 'entry') || tradeInvalidations(t).some(inv => !hasAlert(t.id, inv.key))));
  const trackable = [...active, ...pendingOrders, ...watchEntries];
  if (!trackable.length || !window._fb?.updateDoc) return;
  let touched = 0;
  let touchedEntries = 0;
  for (const t of trackable) {
    const {start, end} = getLevelCheckWindow(t);
    if (end - start < 60 * 1000) continue;
    const invLevels = tradeInvalidations(t).map(inv => [inv.key, inv.price]);
    const pendingLevels = ['pending','watchlist'].includes(t.status)
      ? [['entry', t.entry], ...invLevels].filter(([level,value]) => value && !hasAlert(t.id, level))
      : [['sl', t.sl], ['liq', !t.sl ? t.liquidation : 0], ['tp1', t.tp1], ['tp2', t.tp2], ['tp3', t.tp3], ...invLevels].filter(([level,value]) => value && !hasAlert(t.id, level));
    if (!pendingLevels.length) continue;
    try {
      const candles = await fetchLevelCandles(t, start, end);
      const updates = { levelAlertCheckedAt: new Date().toISOString() };
      for (const [level, value] of pendingLevels) {
        const hit = candleHitForLevel(t, level, Number(value), candles);
        if (!hit) continue;
        const payload = alertPayload(level, { ...hit, source:'historical' });
        t.levelAlerts = { ...(t.levelAlerts||{}), [level]: payload };
        rememberLocalAlert(t.id, level, payload);
        updates['levelAlerts.'+level] = payload;
        if (level === 'entry') touchedEntries++;
        touched++;
      }
      if (Object.keys(updates).length > 1) updates.updatedAt = new Date().toISOString();
      await window._fb.updateDoc(window._fb.doc(window._fb.db,'trades',t.id), updates);
    } catch(e) {
      console.warn('Revision historica de niveles fallida:', t.ticker, e.message);
    }
  }
  if (touched) {
    renderWatchlist?.();
    renderPositions?.();
    renderOrders?.();
    const msg = touchedEntries
      ? 'Detecte '+touchedEntries+' setup(s) u orden(es) que tocaron entry mientras no estabas.'
      : 'Detecte '+touched+' nivel(es) tocados mientras no estabas.';
    toast(msg, 'warning');
  }
};

function renderPositions() {
  const G = window.G; if(!G) return;
  const container = document.getElementById('posList');
  if (!container) return;

  const showZombies = window._showZombies || false;
  const allActive   = G.trades().filter(t=>t.status==='active'||t.status==='zombie');
  const activeOnly = allActive.filter(t=>t.status==='active');
  const pendingCount = G.trades().filter(t=>t.status==='pending').length;
  const manualActive = showZombies ? allActive : allActive.filter(t=>t.status==='active');
  const zombieCount = allActive.filter(t=>t.status==='zombie').length;
  const zombieBtn = document.getElementById('zombieToggleBtn');
  if (zombieBtn) {
    zombieBtn.style.display = zombieCount ? 'inline-flex' : 'none';
    zombieBtn.textContent = showZombies ? 'Ocultar zombies' : 'Ver zombies';
  }
  const summaryEl = document.getElementById('posSummary');
  const summaryRisk = activeOnly.reduce((s,t)=>s+openRiskOf(t),0);
  let summaryPnl = 0, missingPrices = 0;
  activeOnly.forEach(t => {
    const price = G.getPrice(t.ticker, t.dir);
    if (!price) { missingPrices++; return; }
    const sign = (t.dir==='short') ? -1 : 1;
    summaryPnl += Math.round((t.posSize/t.entry)*(price-t.entry)*sign*100)/100;
  });
  if (summaryEl) {
    summaryEl.innerHTML = `${activeOnly.length} pos &middot; ${pendingCount} ord &middot; <span class="${summaryPnl>=0?'pnl-pos':'pnl-neg'}">${summaryPnl>=0?'+':'-'}$${fmt(Math.abs(summaryPnl))}</span>${missingPrices?` <span style="color:var(--amber);">(${missingPrices} sin precio)</span>`:''} &middot; riesgo <span style="color:var(--red);">$${fmt(summaryRisk)}</span>`;
  }

  if (!allActive.filter(t=>t.status==='active').length && !showZombies) {
    if (summaryEl) summaryEl.textContent = `${pendingCount} ord - sin posiciones`;
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">◻</div>
      <div class="empty-text">No hay posiciones abiertas</div>
      <div class="empty-sub">Usá la calculadora para abrir una posición</div>
      <button class="btn acc sm" style="margin-top:12px;" onclick="window.showPage('calc')">📊 Calculadora</button>
    </div>`;
    return;
  }

  // Sort by distance to SL (closest = most at risk = first)
  const sorted = [...manualActive].sort((a, b) => {
    const pA = G.getPrice(a.ticker, a.dir);
    const pB = G.getPrice(b.ticker, b.dir);
    const dA = pA && a.sl ? Math.abs(pA - a.sl) / pA : Infinity;
    const dB = pB && b.sl ? Math.abs(pB - b.sl) / pB : Infinity;
    return dA - dB;
  });

  let totalPnl = 0;
  sorted.filter(t=>t.status==='active').forEach(t => {
    const price = G.getPrice(t.ticker, t.dir);
    if (!price) return;
    const sign = (t.dir==='short') ? -1 : 1;
    totalPnl += Math.round((t.posSize/t.entry)*(price-t.entry)*sign*100)/100;
  });
  const totalRisk = sorted.filter(t=>t.status==='active').reduce((s,t)=>s+openRiskOf(t),0);
  const noSlCount = sorted.filter(t=>t.status==='active' && !Number(t.sl)).length;

  const totalHtml = manualActive.length ? `
    <div class="live-pnl-total">
      <div>
        <div style="font-size:11px;color:var(--t3);font-family:var(--mono);">CAPITAL EN RIESGO</div>
        <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--red);">$${fmt(totalRisk)}</div>
        ${noSlCount?`<div style="font-size:10px;color:var(--amber);font-family:var(--mono);">${noSlCount} sin SL</div>`:''}
      </div>
      <div style="margin-left:auto;text-align:right;">
        <div style="font-size:11px;color:var(--t3);font-family:var(--mono);">PNL TOTAL EN VIVO</div>
        <div style="font-family:var(--mono);font-size:20px;font-weight:600;" class="${totalPnl>=0?'pnl-pos':'pnl-neg'}">${totalPnl>=0?'+':'-'}$${fmt(Math.abs(totalPnl))}</div>
      </div>
    </div>` : '';

  const cardStates = getCardState();

  const manualHtml = sorted.map(t => {
    try {
    const sym    = t.ticker?.replace(/USDT|BUSD|USD$/,'').toUpperCase() || t.ticker;
    const price  = G.getPrice(t.ticker, t.dir);
    const sign   = (t.dir==='short') ? -1 : 1;
    const contr  = (t.posSize||0) / (t.entry||1);
    const pnl    = price!=null ? Math.round(contr*(price-t.entry)*sign*100)/100 : null;
    const isSpot = t.dir === 'spot';
    const margin = t.dir==='spot' ? (t.posSize||0) : (t.posSize||0)/(t.leverage||1);
    const unitsLabel = positionUnitsLabel(t, t.posSize, t.entry);
    const pnlPct = pnl!=null&&margin ? Math.round(pnl/margin*10000)/100 : null;
    const tps    = [{l:'TP1',v:t.tp1,k:'tp1',pct:t.tp1pct||33},{l:'TP2',v:t.tp2,k:'tp2',pct:t.tp2pct||33},{l:'TP3',v:t.tp3,k:'tp3',pct:t.tp3pct||34}].filter(x=>x.v);
    const closedParts = typeof closedPartsForPosition === 'function' ? closedPartsForPosition(t.id) : [];
    const originalSize = typeof positionOriginalSize === 'function' ? positionOriginalSize(t) : (t.posSize||0);
    const closedSize = closedParts.reduce((s,x)=>s+(Number(x.posSize)||0),0);
    const closedLevelSet = new Set(['tp1','tp2','tp3','sl'].filter(level => isLevelConfirmed(t, level, closedParts)));
    const realizedPnl = closedParts.length ? closedParts.reduce((s,x)=>s+(Number(x.pnl)||0),0) : (Number(t.realizedPnl)||0);
    const openPct = originalSize ? Math.round((t.posSize/originalSize)*10000)/100 : 100;
    const closedPct = originalSize ? Math.round((closedSize/originalSize)*10000)/100 : 0;
    const lev    = t.leverage||1;
    const liq    = estimatedLiquidationPrice(t);
    const fakeT  = { entry:t.entry, sl:t.sl, tp1:t.tp1, tp2:t.tp2, tp3:t.tp3, dir:t.dir, liquidation: t.liquidation||liq, invalidations:t.invalidations };
    const slDistPct = t.sl&&t.entry ? Math.abs(t.sl-t.entry)/t.entry*100 : null;
    const riskUsd   = t.risk || (t.posSize&&slDistPct ? t.posSize*slDistPct/100 : null);
    const priceChg  = price&&t.entry ? (price-t.entry)/t.entry*100*sign : null;
    const isMin = !!cardStates[t.id];
    const alert = getPositionAlert(t, price);
    const dirBadge = dirBadgeColors(t.dir);
    const dirColor = dirBadge.color;
    const dirBg    = dirBadge.bg;
    const dirBorder= dirBadge.border;
    const accentColor = t.status==='zombie' ? '#666' : 'var(--accent)';

    // Collapse button — circle
    const collapseBtn = `<button onclick="window.toggleCardMin('${t.id}')" title="${isMin?'Expandir':'Colapsar'}"
      style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.35);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${isMin?'▼':'▲'}</button>`;

    // R:R calculator
    const rrFor = (tp) => {
      if (!tp || !t.sl || !t.entry) return null;
      const reward = Math.abs(tp - t.entry);
      const risk   = Math.abs(t.sl - t.entry);
      if (!risk) return null;
      return (reward/risk).toFixed(1);
    };

    // Header — same for min and expanded
    const header = `
      <div style="padding:13px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="width:8px;height:8px;border-radius:50%;background:${t.status==='zombie'?'#666':'#22c55e'};flex-shrink:0;"></div>
            <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--t1);">${t.ticker||'—'}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${dirBg};color:${dirColor};font-family:var(--mono);border:0.5px solid ${dirBorder};">${dirLevLabel(t)}</span>
            ${t.exchange?`<a href="${getExchangeUrl(t.exchange, t.ticker, t.dir)||'#'}" target="_blank" rel="noopener"
              style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2);text-decoration:none;">${t.exchange} ↗</a>`:''}
            ${t.traderName?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);">· ${t.traderName}</span>`:''}
            ${alert.badges?`<span style="display:inline-flex;gap:4px;">${alert.badges}</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div style="font-size:20px;font-weight:700;font-family:var(--mono);" class="${pnl==null?'':pnl>=0?'pnl-pos':'pnl-neg'}"
            data-pnl="${sym}" data-entry="${t.entry}" data-pos="${t.posSize}" data-dir="${t.dir}" data-manual="true">
            ${pnl!=null?(pnl>=0?'+':'-')+'$'+fmt(Math.abs(pnl)):'—'}
          </div>
          ${collapseBtn}
        </div>
      </div>`;

    // Minimized
    if (isMin) {
      const barHtml = t.entry&&(t.sl||t.tp1) ? buildPriceBar(fakeT, price||0) : '';
      return `<div class="pos-card ${alert.cardClass}" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${accentColor};margin-bottom:8px;overflow:hidden;${t.status==='zombie'?'opacity:0.6;':''}">
        ${header}
        ${barHtml?`<div style="padding:0 16px 14px;">${barHtml}</div>`:''}
      </div>`;
    }

    // Expanded — new design
    return `<div class="pos-card ${alert.cardClass}" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${accentColor};margin-bottom:8px;overflow:hidden;${t.status==='zombie'?'opacity:0.6;':''}">
      ${header}

      ${t.entry&&(t.sl||t.tp1) ? `<div style="padding:0 16px 16px;">${buildPriceBar(fakeT, price||0)}</div>` : ''}

      ${isSpot && (t.sl || margin || t.posSize) ? `
      <div style="display:grid;grid-template-columns:1fr 0.5px 1fr 0.5px 1fr 0.5px 1fr;border-top:0.5px solid var(--border2);border-bottom:0.5px solid var(--border2);">
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:${t.sl ? 'rgba(224,82,82,0.6)' : 'var(--blue)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${t.sl ? 'Riesgo a SL' : 'Capital expuesto'}</div>
          <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:${t.sl ? 'var(--red)' : 'var(--blue)'};">${t.sl ? '-$'+fmt(riskUsd||0) : '$'+fmt(t.posSize||0)}</div>
          <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">${t.sl && slDistPct ? slDistPct.toFixed(1)+'% entry' : 'spot sin liquidacion'}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Capital invertido</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(displaySize||0)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Precio actual</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">${price ? '$'+fmtPx(price) : '-'}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Tamaño</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t2);">${unitsLabel}</div>
        </div>
      </div>` : ''}

      ${(!isSpot && (t.sl || margin || t.posSize)) ? `
      <div style="display:grid;grid-template-columns:1fr 0.5px 1fr 0.5px 1fr 0.5px 1fr;border-top:0.5px solid var(--border2);border-bottom:0.5px solid var(--border2);">
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:${t.sl ? 'rgba(224,82,82,0.6)' : 'var(--amber)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${t.sl ? 'SL Riesgo' : 'Riesgo en liq.'}</div>
          ${t.sl ? `
            <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--red);">−$${fmt(riskUsd||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">${slDistPct?slDistPct.toFixed(1)+'% entry':''}</div>
          ` : `
            <div style="font-size:18px;font-weight:800;font-family:var(--mono);color:var(--amber);">−$${fmt(margin||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">margen</div>
          `}
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Margen</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(margin)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Nominal</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(t.posSize)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Tamaño</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t2);">${unitsLabel}</div>
        </div>
      </div>` : ''}

      ${tps.length ? `
      <div style="display:grid;grid-template-columns:${tps.map(()=>'1fr').join(' ')};border-bottom:0.5px solid var(--border2);">
        ${tps.map((tp,i) => {
          const tpColors = ['#4ade80','#22c55e','#16a34a'];
          const tpColor  = tpColors[i] || '#4ade80';
          const tpBg     = ['rgba(74,222,128,0.03)','rgba(34,197,94,0.03)','rgba(22,163,74,0.03)'][i] || 'transparent';
          const distFromEntry = tp.v&&t.entry ? Math.abs((tp.v-t.entry)/t.entry*100) : null;
          const tpCloseSize = Math.min(originalSize ? originalSize * (tp.pct/100) : (t.posSize||0) * (tp.pct/100), t.posSize||0);
          const tpPnlAmt = tpCloseSize&&t.entry ? Math.round((tpCloseSize/t.entry)*(tp.v-t.entry)*(t.dir==='short'?-1:1)*100)/100 : null;
          const rr = rrFor(tp.v);
          const closure = levelClosureOf(t, tp.k, closedParts);
          const isClosedTp = !!closure;
          const clickAttr = isClosedTp ? '' : `onclick="closeAtTP('${t.id}','${tp.k}',${tp.v})"`;
          const closedPctLabel = closure?.closePctOriginal ? Math.round(closure.closePctOriginal*100)/100 + '%' : tp.pct + '%';
          const closedPriceLabel = closure?.closePrice ? '$' + fmtPx(closure.closePrice) : '$' + fmtPx(tp.v);
          return `<div style="padding:10px 14px;${i<tps.length-1?'border-right:0.5px solid var(--border2);':''}background:${isClosedTp?'rgba(34,197,94,0.055)':tpBg};${isClosedTp?'border-top:1px solid rgba(34,197,94,0.35);':'cursor:pointer;'}" ${clickAttr}>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;gap:8px;">
              <span style="font-size:8px;color:${tpColor};opacity:0.8;text-transform:uppercase;letter-spacing:.06em;">${tp.l} · ${isClosedTp?'cerrado ':''}${isClosedTp?closedPctLabel:tp.pct+'%'}</span>
              <span style="display:flex;align-items:center;gap:6px;">
                ${isClosedTp?`<span style="width:18px;height:18px;border-radius:50%;background:#00c47a;color:rgba(0,0,0,0.62);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;box-shadow:0 0 10px rgba(0,196,122,0.35);">&#10003;</span>`:''}
                ${rr?`<span style="font-size:9px;font-family:var(--mono);color:#22c55e;">${rr}:1</span>`:''}
              </span>
            </div>
            <div style="font-size:14px;font-weight:600;font-family:var(--mono);color:${tpColor};">${isClosedTp?closedPriceLabel:'$'+fmtPx(tp.v)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">
              ${isClosedTp?'confirmado':(distFromEntry!=null?`+${distFromEntry.toFixed(1)}%`:'')} ${!isClosedTp&&tpPnlAmt!=null?`· +$${fmt(tpPnlAmt)}`:''}
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${closedParts.length ? `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:0.5px solid var(--border2);background:rgba(0,0,0,0.10);">
        <div style="padding:8px 14px;"><div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Cerrado</div><div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--t2);">${closedPct}%</div></div>
        <div style="padding:8px 14px;border-left:0.5px solid var(--border2);border-right:0.5px solid var(--border2);"><div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Abierto</div><div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--accent);">${openPct}%</div></div>
        <div style="padding:8px 14px;"><div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">PnL realizado</div><div style="font-size:13px;font-weight:600;font-family:var(--mono);" class="${realizedPnl>=0?'pnl-pos':'pnl-neg'}">${realizedPnl>=0?'+':'-'}$${fmt(Math.abs(realizedPnl))}</div></div>
      </div>
` : ''}

      ${cleanAutoCloseNotes(t.notes)?`<div style="font-size:11px;color:var(--t2);padding:6px 12px;background:var(--bg3);border-bottom:0.5px solid var(--border2);">${cleanAutoCloseNotes(t.notes)}</div>`:''}
      ${invalidationNotesHtml(t)}

      <div style="display:grid;grid-template-columns:2fr 3fr 1fr 1fr;gap:8px;padding:10px 14px;background:rgba(0,0,0,0.15);">
        <select onchange="window.moveCardToStatus('${t.id}', this.value)"
          style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;">
          <option value="watchlist">👁 Watchlist</option>
          <option value="pending">⏳ Órdenes</option>
          <option value="active" ${t.status==='active'?'selected':''}>🟢 Posición</option>
        </select>
        ${t.status!=='zombie'
          ? `<button style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;" onclick="openCloseTrade('${t.id}')">Cerrar</button>`
          : `<button style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:11px;cursor:pointer;" onclick="window.toggleZombie('${t.id}',false)">↩ Restaurar</button>`
        }
        <button style="background:var(--bg3);color:var(--t3);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="openEditTrade('${t.id}')">✎</button>
        <button style="background:rgba(224,82,82,0.08);color:var(--red);border:0.5px solid rgba(224,82,82,0.15);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="deleteTrade('${t.id}')">✕</button>
      </div>
    </div>`;
    } catch(e) {
      console.error('position card render error:', t?.id, e);
      return `<div class="pos-card" style="border-left:3px solid var(--amber);">
        <div class="pos-card-header">
          <div class="pos-card-left">
            <span class="status-dot-amber"></span>
            <span class="pos-card-ticker">${dashSafe(t?.ticker || 'Posicion')}</span>
          </div>
          <button class="btn sm" onclick="openEditTrade('${t?.id || ''}')">Editar</button>
        </div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--amber);line-height:1.6;">
          Esta posicion tiene un dato incompleto. Editala y guarda para normalizarla.
        </div>
      </div>`;
    }
  }).join('');

  container.innerHTML = totalHtml + manualHtml;
}


// ── Exposure Map ───────────────────────────────────────────────────────────
function mapTickerOf(t) {
  return String(t?.ticker || t?.symbol || '').replace(/USDT|BUSD|USD$/,'').toUpperCase();
}

function mapCurrentPrice(sym) {
  const G = window.G;
  if (!G || !sym) return null;
  return G.getPrice(sym, 'futures') || G.getPrice(sym+'USDT', 'futures') || G.getPrice(sym, 'spot') || G.getPrice(sym+'USDT', 'spot') || null;
}

function mapLivePnl(t, price) {
  const entry = Number(t?.entry) || 0;
  const size = Number(t?.posSize) || 0;
  if (!entry || !size || !price || t.status !== 'active') return null;
  const sign = t.dir === 'short' ? -1 : 1;
  return Math.round((size / entry) * (price - entry) * sign * 100) / 100;
}

function mapExposureOf(t) {
  if (t.status !== 'active') return 0;
  const size = Number(t.posSize) || 0;
  if (!size) return 0;
  return t.dir === 'short' ? -size : size;
}

function mapBuildTickerBar(items, currentPrice) {
  const points = [];
  const segments = [];
  const addPoint = (price, label, color, weight=1) => {
    price = Number(price) || 0;
    if (price > 0) points.push({ price, label, color, weight });
  };
  const addSegment = (a, b, color, opacity=.28) => {
    a = Number(a) || 0; b = Number(b) || 0;
    if (a > 0 && b > 0 && a !== b) segments.push({ a, b, color, opacity });
  };

  items.forEach(item => {
    const t = item.trade;
    const prefix = item.kind === 'position' ? 'P' : item.kind === 'order' ? 'O' : 'W';
    const dir = String(t.dir||'').toUpperCase();
    addPoint(t.entry || t.price, `${prefix} ${dir}`, item.color, 2);
    addPoint(t.sl, 'SL', 'var(--red)', 2);
    addPoint(t.liquidation, 'Liq', 'var(--amber)', 1);
    addPoint(t.tp1, 'TP1', '#4ade80', 1);
    addPoint(t.tp2, 'TP2', '#22c55e', 1);
    addPoint(t.tp3, 'TP3', '#16a34a', 1);
    tradeInvalidations(t).forEach((inv, idx) => addPoint(inv.price, inv.label || `Inv ${idx+1}`, '#38bdf8', 1));
    if (t.entry && t.sl) addSegment(t.entry, t.sl, 'var(--red)', .28);
    if (t.entry && !t.sl && t.liquidation) addSegment(t.entry, t.liquidation, 'var(--amber)', .28);
    [t.tp1,t.tp2,t.tp3].filter(Boolean).forEach(tp => addSegment(t.entry, tp, 'var(--accent)', .18));
  });
  if (currentPrice) points.push({ price: currentPrice, label: 'Actual', color: '#e040fb', current: true, weight: 3 });

  const prices = points.map(p=>p.price).filter(Boolean);
  if (prices.length < 2) return `<div style="font-family:var(--mono);font-size:11px;color:var(--t3);">Faltan niveles para dibujar el mapa.</div>`;

  let minP = Math.min(...prices);
  let maxP = Math.max(...prices);
  const mid = currentPrice || prices.reduce((s,p)=>s+p,0)/prices.length;
  if ((maxP - minP) / Math.max(mid, 1) < .015) { minP = mid * .9925; maxP = mid * 1.0075; }
  minP *= .998; maxP *= 1.002;
  const range = maxP - minP;
  const pct = p => Math.max(0, Math.min(100, ((p - minP) / range) * 100));

  const segmentHtml = segments.map(s => {
    const l = Math.min(pct(s.a), pct(s.b));
    const r = Math.max(pct(s.a), pct(s.b));
    return `<div style="position:absolute;left:${l}%;width:${Math.max(1,r-l)}%;top:39px;height:6px;background:${s.color};opacity:${s.opacity};border-radius:3px;"></div>`;
  }).join('');

  const markerHtml = points
    .sort((a,b)=>a.price-b.price || b.weight-a.weight)
    .slice(0, 34)
    .map((p, i) => {
      const left = pct(p.price);
      const topOffset = i % 2 ? '54px' : '-25px';
      const priceTop = i % 2 ? '-17px' : '12px';
      const cls = p.current ? 'map-marker current' : 'map-marker';
      return `<div class="${cls}" style="left:${left}%;">
        <div class="map-marker-dot" style="background:${p.color};"></div>
        <div class="map-marker-label" style="top:${topOffset};color:${p.color};">${dashSafe(p.label)}</div>
        <div class="map-marker-price" style="top:${priceTop};">$${fmtPx(p.price)}</div>
      </div>`;
    }).join('');

  return `<div class="map-line">
    <div class="map-axis"></div>
    ${segmentHtml}
    ${markerHtml}
  </div>`;
}

function mapRow(item, currentPrice) {
  const t = item.trade;
  const pnl = item.kind === 'position' ? mapLivePnl(t, currentPrice) : null;
  const entry = Number(t.entry || t.price) || 0;
  const invCount = tradeInvalidations(t).length;
  const meta = [
    t.exchange || '',
    t.traderName ? '· '+t.traderName : '',
    entry ? 'entry $'+fmtPx(entry) : '',
    t.sl ? 'SL $'+fmtPx(t.sl) : '',
    invCount ? `${invCount} inv.` : ''
  ].filter(Boolean).join(' ');
  const right = item.kind === 'position'
    ? (pnl==null ? 'sin precio' : `${pnl>=0?'+':'-'}$${fmt(Math.abs(pnl))}`)
    : item.kind === 'order'
      ? 'pendiente'
      : 'idea';
  const rightCls = item.kind === 'position' && pnl != null ? (pnl >= 0 ? 'pnl-pos' : 'pnl-neg') : '';
  return `<div class="map-row">
    <div class="map-kind" style="color:${item.color};">${item.label}</div>
    <div>
      <span style="font-weight:700;color:var(--t1);">${dashSafe(t.ticker||'')}</span>
      <span class="badge ${t.dir==='short'?'bs':t.dir==='spot'?'bsp':'bl'}" style="margin-left:6px;">${dirLevLabel(t)}</span>
      <span style="color:var(--t3);margin-left:6px;">${dashSafe(meta)}</span>
    </div>
    <div class="${rightCls}" style="font-weight:700;text-align:right;">${right}</div>
  </div>`;
}

function renderMap() {
  const G = window.G; if (!G) return;
  const container = document.getElementById('mapList');
  if (!container) return;
  const incPositions = document.getElementById('mapIncPositions')?.checked !== false;
  const incOrders = document.getElementById('mapIncOrders')?.checked !== false;
  const incWatch = document.getElementById('mapIncWatch')?.checked !== false;

  const source = [];
  G.trades().forEach(t => {
    if (incPositions && t.status === 'active') source.push({ kind:'position', label:'Posición', color:'var(--accent)', trade:t });
    if (incOrders && t.status === 'pending') source.push({ kind:'order', label:'Orden', color:'var(--amber)', trade:t });
    if (incWatch && t.status === 'watchlist') source.push({ kind:'watch', label:'Watch', color:'var(--red)', trade:t });
  });

  const groups = {};
  source.forEach(item => {
    const sym = mapTickerOf(item.trade);
    if (!sym) return;
    groups[sym] = groups[sym] || [];
    groups[sym].push(item);
  });

  const sorted = Object.entries(groups).sort((a,b) => {
    const ap = a[1].filter(x=>x.kind==='position').length;
    const bp = b[1].filter(x=>x.kind==='position').length;
    return bp - ap || a[0].localeCompare(b[0]);
  });

  if (!sorted.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><div class="empty-text">No hay elementos para mostrar</div><div class="empty-sub">Activá Posiciones, Órdenes o Watchlist.</div></div>`;
    return;
  }

  container.innerHTML = sorted.map(([sym, items]) => {
    const currentPrice = mapCurrentPrice(sym);
    const positions = items.filter(x=>x.kind==='position').map(x=>x.trade);
    const orders = items.filter(x=>x.kind==='order').length;
    const watches = items.filter(x=>x.kind==='watch').length;
    const pnl = positions.reduce((s,t)=>s+(mapLivePnl(t, currentPrice)||0),0);
    const risk = positions.reduce((s,t)=>s+openRiskOf(t),0);
    const net = positions.reduce((s,t)=>s+mapExposureOf(t),0);
    const hasLong = positions.some(t=>t.dir==='long' || t.dir==='spot');
    const hasShort = positions.some(t=>t.dir==='short');
    const netTxt = !positions.length ? '—' : `${net>0?'LONG':net<0?'SHORT':'NEUTRAL'} $${fmt(Math.abs(net))}`;
    const conflict = hasLong && hasShort ? `<div style="margin-top:10px;font-family:var(--mono);font-size:11px;color:var(--amber);">⚠ Long y short simultáneos en ${sym}</div>` : '';
    return `<div class="map-group">
      <div class="map-group-head">
        <div>
          <div class="map-group-title">${dashSafe(sym)}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--t3);margin-top:4px;">${positions.length} pos · ${orders} ord · ${watches} watch</div>
          ${conflict}
        </div>
        <div class="map-metrics">
          <div class="map-metric">Precio<strong>${currentPrice?'$'+fmtPx(currentPrice):'—'}</strong></div>
          <div class="map-metric">PnL<strong class="${pnl>=0?'pnl-pos':'pnl-neg'}">${positions.length?(pnl>=0?'+':'-')+'$'+fmt(Math.abs(pnl)):'—'}</strong></div>
          <div class="map-metric">Riesgo<strong style="color:var(--red);">${positions.length?'$'+fmt(risk):'—'}</strong></div>
          <div class="map-metric">Exposición<strong>${netTxt}</strong></div>
        </div>
      </div>
      <div class="map-price-wrap">${mapBuildTickerBar(items, currentPrice)}</div>
      <div class="map-rows">${items.map(item=>mapRow(item, currentPrice)).join('')}</div>
    </div>`;
  }).join('');
}

window.renderMap = renderMap;

// ── History ────────────────────────────────────────────────────────────────
function checkPendingReviews() {
  const G = window.G;
  const pending = (G?.trades()||[]).filter(t => t.status === 'pending_review');
  const badge = document.getElementById('pendingReviewBadge');
  if (pending.length > 0) {
    if (!badge) {
      const nav = document.querySelector('[data-page="history"]');
      if (nav) {
        const b = document.createElement('span');
        b.id = 'pendingReviewBadge';
        b.style.cssText = 'background:var(--amber);color:#000;border-radius:10px;padding:1px 6px;font-size:9px;margin-left:4px;font-weight:700;';
        b.textContent = pending.length;
        nav.appendChild(b);
      }
    } else {
      badge.textContent = pending.length;
    }
    // pending review badge shown silently — no toast
  } else if (badge) {
    badge.remove();
  }
}

// ── History sort state
let _histSort = { col: 'fcierre', dir: -1 };
let _dashHistSort = { col: 'fcierre', dir: -1 };
window.sortHistory = function(col) {
  if (_histSort.col === col) _histSort.dir *= -1;
  else { _histSort.col = col; _histSort.dir = -1; }
  renderHistory();
};
window.sortDashHistory = function(col) {
  if (_dashHistSort.col === col) _dashHistSort.dir *= -1;
  else { _dashHistSort.col = col; _dashHistSort.dir = -1; }
  renderDashHistory();
};

const historyCloseDateOf = t => t.closeDate || t.closedAt || t.updatedAt || '';
const historyNotesOf = t => [t.notes, t.closeNotes].filter(Boolean).join(' · ');
const historyColValue = (t, col) => {
  const valueMap = {
    ticker: t.ticker,
    dir: t.dir,
    exchange: t.exchange,
    trader: t.traderName,
    entry: t.entry,
    exit: t.closePrice || t.exitPrice || t.exit,
    pnl: t.pnl,
    pnlpct: t.pnlPct,
    fentrada: t.createdAt,
    fcierre: historyCloseDateOf(t),
    result: (t.pnl || 0) >= 0 ? 'win' : 'loss',
    notes: historyNotesOf(t),
  };
  return valueMap[col] ?? '';
};
function sortHistoryRows(rows, sortState) {
  const numericCols = new Set(['entry','exit','pnl','pnlpct']);
  const dateCols = new Set(['fentrada','fcierre','closeDate']);
  const col = sortState.col === 'closeDate' ? 'fcierre' : sortState.col;
  return [...rows].sort((a,b) => {
    const av = historyColValue(a, col);
    const bv = historyColValue(b, col);
    if (numericCols.has(col)) return ((Number(av)||0) - (Number(bv)||0)) * sortState.dir;
    if (dateCols.has(col)) return ((new Date(av||0).getTime()||0) - (new Date(bv||0).getTime()||0)) * sortState.dir;
    return String(av||'').localeCompare(String(bv||''), 'es', {numeric:true, sensitivity:'base'}) * sortState.dir;
  });
}
function getFilteredHistoryRows(context='history') {
  const G = window.G; if(!G) return [];
  const prefix = context === 'dashboard' ? 'dash' : '';
  const tickerId = prefix ? 'dashFiltTicker' : 'filtTicker';
  const dirId = prefix ? 'dashFiltDir' : 'filtDir';
  const traderId = prefix ? 'dashFiltTrader' : 'filtTrader';
  const resultId = prefix ? 'dashFiltResult' : 'filtResult';
  const ticker = (document.getElementById(tickerId)?.value || '').trim().toLowerCase();
  const dir = document.getElementById(dirId)?.value || '';
  const trader = document.getElementById(traderId)?.value || '';
  const result = document.getElementById(resultId)?.value || '';
  let rows = G.trades().filter(t => t.status === 'closed');
  if(ticker) rows = rows.filter(t => (t.ticker||'').toLowerCase().includes(ticker));
  if(dir) rows = rows.filter(t => t.dir === dir);
  if(trader) rows = rows.filter(t => t.traderName === trader);
  if(result === 'win') rows = rows.filter(t => (t.pnl||0) > 0);
  if(result === 'loss') rows = rows.filter(t => (t.pnl||0) <= 0);
  return sortHistoryRows(rows, context === 'dashboard' ? _dashHistSort : _histSort);
}

let _equityVisible = {};
try { _equityVisible = JSON.parse(localStorage.getItem('mauex_equity_visible') || '{}') || {}; } catch(e) { _equityVisible = {}; }
const EQUITY_COLORS = ['#3d9cf0','#00c47a','#f59e0b','#e040fb','#38bdf8','#ff4d6d','#a78bfa','#22c55e','#f97316','#14b8a6'];
function equityColorFor(name, idx) {
  if (name === '__total') return '#3d9cf0';
  return EQUITY_COLORS[(idx + 1) % EQUITY_COLORS.length];
}
window.toggleEquitySeries = (key, checked) => {
  _equityVisible[key] = checked;
  localStorage.setItem('mauex_equity_visible', JSON.stringify(_equityVisible));
  const closed = window.G?.trades?.().filter(t => t.status === 'closed') || [];
  renderHistCharts(closed);
};

function renderHistCharts(trades) {
  const el = document.getElementById('histCharts');
  if (!el) return;
  if (!trades.length) { el.innerHTML=''; return; }

  // Helper: info tooltip on chart titles
  const info = (text) => `<span class="info-dot" data-tip="${dashSafe(text)}" title="${dashSafe(text)}" style="margin-left:5px;vertical-align:middle;">i</span>`;

  const sorted = [...trades].sort((a,b)=>new Date(historyCloseDateOf(a)||a.closeDate||a.createdAt)-new Date(historyCloseDateOf(b)||b.closeDate||b.createdAt));
  let cum = 0;
  const equityPoints = sorted.map(t=>{
    const date = historyCloseDateOf(t) || t.closeDate || t.createdAt || '';
    cum+=t.pnl||0;
    return { v: cum, date, pnl: t.pnl||0, trader: t.traderName || 'Sin trader', ticker: t.ticker || '' };
  });
  const eqVals = equityPoints.map(p=>p.v);
  const maxEq = Math.max(...eqVals, 0);
  const minEq = Math.min(...eqVals, 0);
  const eqRange = maxEq - minEq || 1;

  // Monthly PnL
  const months = {};
  sorted.forEach(t=>{ const d=new Date(t.closeDate||t.createdAt); const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); months[k]=(months[k]||0)+(t.pnl||0); });
  const mKeys = Object.keys(months).sort();
  const mVals = mKeys.map(k=>months[k]);
  const maxM = Math.max(...mVals.map(Math.abs),1);

  // Stats
  const wins = trades.filter(t=>(t.pnl||0)>0);
  const losses = trades.filter(t=>(t.pnl||0)<0);
  const winRate = trades.length ? Math.round(wins.length/trades.length*100) : 0;
  const avgWin = wins.length ? Math.round(wins.reduce((s,t)=>s+(t.pnl||0),0)/wins.length) : 0;
  const avgLoss = losses.length ? Math.round(losses.reduce((s,t)=>s+(t.pnl||0),0)/losses.length) : 0;
  const expectancy = Math.round(((winRate/100)*avgWin+((1-winRate/100)*avgLoss))*100)/100;

  // Trader stats
  const byTrader = {};
  trades.forEach(t=>{
    const n=t.traderName||'Sin trader';
    if(!byTrader[n]) byTrader[n]={pnl:0,count:0,wins:0,losses:0,sumWin:0,sumLoss:0,maxLoss:0,streak:0,curStreak:0};
    byTrader[n].pnl+=t.pnl||0;
    byTrader[n].count++;
    if((t.pnl||0)>0){ byTrader[n].wins++; byTrader[n].sumWin+=t.pnl; byTrader[n].curStreak=Math.max(0,byTrader[n].curStreak)+1; }
    else { byTrader[n].losses++; byTrader[n].sumLoss+=t.pnl||0; byTrader[n].maxLoss=Math.min(byTrader[n].maxLoss,t.pnl||0); byTrader[n].curStreak=Math.min(0,byTrader[n].curStreak)-1; }
  });
  const trKeys = Object.keys(byTrader).sort((a,b)=>byTrader[b].pnl-byTrader[a].pnl);
  const maxTrPnl = Math.max(...trKeys.map(k=>Math.abs(byTrader[k].pnl)),1);
  const equityTraderKeys = trKeys;
  if (_equityVisible.__total == null) _equityVisible.__total = true;
  equityTraderKeys.forEach(name => { if (_equityVisible[name] == null) _equityVisible[name] = true; });
  const equityControls = [
    { key:'__total', label:'Total', color:equityColorFor('__total', 0) },
    ...equityTraderKeys.map((name,i)=>({ key:name, label:name, color:equityColorFor(name, i) })),
  ].map(item => `<label class="equity-toggle" title="${dashSafe(item.label)}">
    <input type="checkbox" ${_equityVisible[item.key] ? 'checked' : ''} onchange="window.toggleEquitySeries(${dashSafe(JSON.stringify(item.key))}, this.checked)">
    <span class="equity-color" style="background:${item.color};"></span>
    <span>${dashSafe(item.label)}</span>
  </label>`).join('');

  // Drawdown
  let peak=0, maxDd=0;
  eqVals.forEach(v=>{ if(v>peak) peak=v; const dd=peak-v; if(dd>maxDd) maxDd=dd; });
  const totPnl = trades.reduce((s,t)=>s+(t.pnl||0),0);

  // Distribution buckets
  const pnlVals = trades.map(t=>t.pnl||0);
  const pMin = Math.min(...pnlVals), pMax = Math.max(...pnlVals);
  const bucketCount = 8;
  const bucketSize = (pMax-pMin)/bucketCount || 1;
  const buckets = Array(bucketCount).fill(0);
  pnlVals.forEach(v=>{ const i=Math.min(Math.floor((v-pMin)/bucketSize), bucketCount-1); buckets[i]++; });
  const maxBucket = Math.max(...buckets,1);

  // Monthly bars — flex-based, fill available height
  const bars = mVals.map((v,i)=>{
    const pct = Math.max(2, Math.abs(v)/maxM*50); // % of half-height
    const c = v>=0?'var(--accent)':'var(--red)';
    const lbl = mKeys[i].split('-')[1]+'/'+mKeys[i].split('-')[0].slice(2);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:0;min-width:0;">
      <div style="flex:1;display:flex;align-items:flex-end;width:100%;padding-bottom:0;">
        ${v>=0?`<div title="${v>=0?'+':''}$${fmt(v)}" style="width:100%;height:${pct}%;background:${c};border-radius:2px 2px 0 0;opacity:0.85;min-height:${v!==0?'3px':'0'};"></div>`:`<div style="width:100%;"></div>`}
      </div>
      <div style="height:1px;width:100%;background:rgba(255,255,255,0.1);flex-shrink:0;"></div>
      <div style="flex:1;display:flex;align-items:flex-start;width:100%;padding-top:0;">
        ${v<0?`<div title="$${fmt(v)}" style="width:100%;height:${pct}%;background:${c};border-radius:0 0 2px 2px;opacity:0.85;min-height:${v!==0?'3px':'0'};"></div>`:`<div style="width:100%;"></div>`}
      </div>
      <div style="font-size:8px;color:var(--t3);white-space:nowrap;margin-top:3px;flex-shrink:0;">${mKeys.length<=8?lbl:''}</div>
    </div>`;
  }).join('');

  // Trader performance table
  const trTable = trKeys.map(name=>{
    const d=byTrader[name];
    const wr=d.count?Math.round(d.wins/d.count*100):0;
    const avgW=d.wins?Math.round(d.sumWin/d.wins):0;
    const avgL=d.losses?Math.round(d.sumLoss/d.losses):0;
    const bw=Math.max(4,Math.abs(d.pnl)/maxTrPnl*80);
    const wrColor=wr>=50?'var(--accent)':'var(--red)';
    return `<div style="display:grid;grid-template-columns:80px 32px 36px 44px 44px 1fr;gap:4px;align-items:center;padding:4px 0;border-bottom:0.5px solid var(--border);">
      <div style="font-size:10px;color:var(--t2);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</div>
      <div style="font-size:9px;color:var(--t3);text-align:center;">${d.count}</div>
      <div style="font-size:10px;font-weight:600;font-family:var(--mono);color:${wrColor};text-align:center;">${wr}%</div>
      <div style="font-size:9px;font-family:var(--mono);color:var(--accent);text-align:right;">+$${fmt(avgW)}</div>
      <div style="font-size:9px;font-family:var(--mono);color:var(--red);text-align:right;">$${fmt(avgL)}</div>
      <div style="height:10px;background:var(--bg3);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${bw}%;background:${d.pnl>=0?'var(--accent)':'var(--red)'};border-radius:2px;"></div>
      </div>
    </div>`;
  }).join('');

  const trHeader = `<div style="display:grid;grid-template-columns:80px 32px 36px 44px 44px 1fr;gap:4px;padding-bottom:4px;border-bottom:0.5px solid var(--border2);">
    <div style="font-size:8px;color:var(--t3);">TRADER</div>
    <div style="font-size:8px;color:var(--t3);text-align:center;">#</div>
    <div style="font-size:8px;color:var(--t3);text-align:center;">WR</div>
    <div style="font-size:8px;color:var(--t3);text-align:right;">AVG W</div>
    <div style="font-size:8px;color:var(--t3);text-align:right;">AVG L</div>
    <div style="font-size:8px;color:var(--t3);">PnL</div>
  </div>`;

  const distBars = buckets.map((count,i)=>{
    const from=Math.round(pMin+i*bucketSize);
    const w=Math.max(4,count/maxBucket*100);
    const c=from>=0?'var(--accent)':'var(--red)';
    return `<div style="display:flex;align-items:center;gap:6px;">
      <div style="font-size:9px;color:var(--t3);font-family:var(--mono);width:70px;text-align:right;">${from>=0?'+':''}${fmt(from)}</div>
      <div style="flex:1;height:14px;background:var(--bg3);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${w}%;background:${c};opacity:0.8;border-radius:2px;"></div>
      </div>
      <div style="font-size:9px;color:var(--t2);font-family:var(--mono);min-width:20px;">${count}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px;">
    <div class="card" style="padding:14px;display:flex;flex-direction:column;">
      <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;">EQUITY CURVE ${info('PnL acumulado en el tiempo.')}</div>
      <div style="flex:1;min-height:120px;position:relative;">
        <canvas id="eqCanvas"></canvas>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;">
        <span style="font-size:10px;color:var(--t3);">Max DD: <span style="color:var(--red);">-$${fmt(maxDd)}</span></span>
        <span style="font-size:12px;font-family:var(--mono);font-weight:600;color:${totPnl>=0?'var(--accent)':'var(--red)'};">${totPnl>=0?'+':''}$${fmt(Math.abs(totPnl))}</span>
      </div>
      <div class="equity-controls">${equityControls}</div>
    </div>
    <div style="display:grid;grid-template-rows:auto 1fr;gap:12px;">
      <div class="card" style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;">
        <div style="grid-column:1/-1;font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:2px;">ESTADÍSTICAS ${info('Métricas clave de performance.')}</div>
        <div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">WIN RATE</div><div style="font-size:20px;font-weight:700;font-family:var(--mono);color:${winRate>=50?'var(--accent)':'var(--red)'};">${winRate}%</div></div>
        <div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">EXPECTANCY</div><div style="font-size:20px;font-weight:700;font-family:var(--mono);color:${expectancy>=0?'var(--accent)':'var(--red)'};">${expectancy>=0?'+':''}$${fmt(Math.abs(expectancy))}</div></div>
        <div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">AVG WIN</div><div style="font-size:16px;font-weight:600;font-family:var(--mono);color:var(--accent);">+$${fmt(avgWin)}</div></div>
        <div><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">AVG LOSS</div><div style="font-size:16px;font-weight:600;font-family:var(--mono);color:var(--red);">${fmt(avgLoss)}</div></div>
      </div>
      <div class="card" style="padding:14px;" id="capitalPieCard">
        <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;">CAPITAL ${info('Distribución del capital: libre, en margen de posiciones y reservado en órdenes.')}</div>
        <div id="capitalPieDiv" style="width:100%;height:110px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:11px;font-family:var(--mono);">Cargando...</div>
      </div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
    <div class="card" style="padding:14px;display:flex;flex-direction:column;">
      <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;">PnL MENSUAL ${info('Resultado neto por mes.')}</div>
      <div style="flex:1;display:flex;flex-direction:column;min-height:140px;">
        <div style="flex:1;display:flex;align-items:flex-end;gap:3px;">
          ${mVals.map((v,i)=>{
            const pct = Math.max(3, Math.abs(v)/maxM*100);
            const c = v>=0?'var(--accent)':'var(--red)';
            const lbl = mKeys[i].split('-')[1]+'/'+mKeys[i].split('-')[0].slice(2);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;">
              <div style="width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:60px;">
                ${v>=0?`<div style="width:80%;background:${c};border-radius:2px 2px 0 0;height:${pct}%;min-height:2px;opacity:0.85;" title="+$${fmt(v)}"></div>`:``}
              </div>
              <div style="height:1px;width:100%;background:rgba(255,255,255,0.1);"></div>
              <div style="width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:60px;">
                ${v<0?`<div style="width:80%;background:${c};border-radius:0 0 2px 2px;height:${pct}%;min-height:2px;opacity:0.85;" title="$${fmt(v)}"></div>`:``}
              </div>
              <div style="font-size:8px;color:var(--t3);white-space:nowrap;margin-top:2px;text-align:center;">${mKeys.length<=8?lbl:''}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="padding:14px;">
      <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;">PERFORMANCE POR TRADER ${info('Tabla de rendimiento por trader/analista. # = cantidad de trades. WR = win rate. Avg W/L = ganancia y pérdida promedio por trade. La barra muestra el PnL total proporcional.')}</div>
      ${trHeader}
      <div style="margin-top:4px;">${trTable}</div>
    </div>
    <div class="card" style="padding:14px;">
      <div style="font-size:10px;color:var(--t3);font-family:var(--mono);margin-bottom:8px;">DISTRIBUCIÓN DE PnL ${info('Histograma de resultados. Cada barra muestra cuántos trades cayeron en ese rango de PnL. Verde = rangos positivos, rojo = negativos. Ideal: muchas barras verdes pequeñas y pocas barras rojas.')}</div>
      <div style="display:flex;flex-direction:column;gap:5px;">${distBars}</div>
    </div>
  </div>`;

  // Draw equity curve on canvas
  setTimeout(() => {
    // ── Equity curve via Chart.js ────────────────────────────────────────
    const canvas = document.getElementById('eqCanvas');
    if (canvas && equityPoints.length >= 2) {
      if (canvas._chartInstance) canvas._chartInstance.destroy();
      const labels = equityPoints.map(p => String(p.date || '').slice(0,10));
      const monthLabel = value => {
        const idx = Number(value) || 0;
        const cur = labels[idx] || '';
        if (!cur) return '';
        const curMonth = cur.slice(0,7);
        const prevMonth = idx > 0 ? (labels[idx-1] || '').slice(0,7) : '';
        if (idx === 0 || curMonth !== prevMonth) {
          const [y,m] = curMonth.split('-');
          return new Date(Number(y), Number(m)-1, 1).toLocaleDateString('es',{month:'short'});
        }
        return '';
      };
      const traderSeries = equityTraderKeys.map((name, i) => {
        let traderCum = 0;
        const deltas = [];
        const data = sorted.map(t => {
          const pnl = (t.traderName || 'Sin trader') === name ? Number(t.pnl)||0 : 0;
          traderCum += pnl;
          deltas.push(pnl);
          return Math.round(traderCum * 100)/100;
        });
        return {
          key:name,
          label:name,
          data,
          deltas,
          borderColor: equityColorFor(name, i),
          borderWidth: 1.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: false,
          hidden: !_equityVisible[name],
        };
      });
      canvas._chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            key:'__total',
            label:'Total',
            data: equityPoints.map(p => Math.round(p.v * 100)/100),
            borderColor: '#3d9cf0',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#3d9cf0',
            tension: 0.25,
            fill: false,
            hidden: !_equityVisible.__total,
          }, ...traderSeries]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: items => {
                  const label = items[0]?.label || '';
                  const d = new Date(label + 'T00:00:00');
                  return Number.isNaN(d.getTime()) ? label : d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
                },
                label: ctx => {
                  const v = ctx.parsed.y;
                  const ds = ctx.dataset || {};
                  const delta = ds.key === '__total' ? equityPoints[ctx.dataIndex]?.pnl || 0 : ds.deltas?.[ctx.dataIndex] || 0;
                  return ` ${ds.label}: ${v>=0?'+':'-'}$${fmt(Math.abs(v))} (${delta>=0?'+':'-'}$${fmt(Math.abs(delta))})`;
                }
              },
              backgroundColor: 'rgba(22,27,34,0.95)',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 0.5,
              titleColor: '#6a7888',
              bodyColor: '#e2e8f0',
              bodyFont: { family: 'monospace', size: 11 },
              titleFont: { family: 'monospace', size: 10 },
            }
          },
          scales: {
            x: {
              ticks: {
                color: '#6a7888', font: { size: 9, family: 'monospace' },
                maxRotation: 0,
                autoSkip: false,
                callback: monthLabel,
              },
              grid: {
                color: ctx => monthLabel(ctx.tick?.value) ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.015)',
                lineWidth: ctx => monthLabel(ctx.tick?.value) ? 1 : 0.5,
              },
            },
            y: {
              ticks: {
                color: '#6a7888', font: { size: 9, family: 'monospace' },
                callback: v => '$' + fmt(v),
                maxTicksLimit: 5,
              },
              grid: { color: 'rgba(255,255,255,0.04)' },
            }
          }
        }
      });
    }

    window._drawCapitalPie();
  }, 80);
}

// ── Capital pie — global, can be called anytime ───────────────────────────
window._drawCapitalPie = () => {
  const div = document.getElementById('capitalPieDiv');
  if (!div) return;
  const rawBalances = window._liquidityCache?.balances;
  const balances = rawBalances ? Object.fromEntries(
    Object.entries(rawBalances).map(([ex, b]) => [ex, normalizeDashboardBalance(b)])
  ) : null;
  if (!balances) { setTimeout(window._drawCapitalPie, 800); return; }
  let libre = 0, margen = 0, ordenes = 0;
  Object.values(balances).forEach(b => {
    libre   += b.free   || 0;
    margen  += b.margin || 0;
    ordenes += b.orders || 0;
  });
  const total = libre + margen + ordenes;
  if (total === 0) { setTimeout(window._drawCapitalPie, 800); return; }

  const slices = [
    { val: libre,   color: '#3d9cf0', label: 'Libre' },
    { val: margen,  color: '#a78bfa', label: 'Margen' },
    { val: ordenes, color: '#f59e0b', label: 'Órdenes' },
  ].filter(s => s.val > 0);

  const cx = 55, cy = 55, r = 42, ri = 24;
  let angle = -Math.PI / 2;
  let paths = '';
  slices.forEach(s => {
    const sweep = (s.val / total) * Math.PI * 2;
    const x1  = cx + r  * Math.cos(angle);
    const y1  = cy + r  * Math.sin(angle);
    const x2  = cx + r  * Math.cos(angle + sweep);
    const y2  = cy + r  * Math.sin(angle + sweep);
    const xi1 = cx + ri * Math.cos(angle + sweep);
    const yi1 = cy + ri * Math.sin(angle + sweep);
    const xi2 = cx + ri * Math.cos(angle);
    const yi2 = cy + ri * Math.sin(angle);
    const lg  = sweep > Math.PI ? 1 : 0;
    paths += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${lg},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${xi1.toFixed(1)},${yi1.toFixed(1)} A${ri},${ri} 0 ${lg},0 ${xi2.toFixed(1)},${yi2.toFixed(1)} Z" fill="${s.color}" opacity="0.85"/>`;
    angle += sweep;
  });

  const legend = slices.map((s, i) => {
    const pct = Math.round(s.val / total * 100);
    const y = 18 + i * 30;
    return `<rect x="122" y="${y}" width="9" height="9" fill="${s.color}" rx="2"/>
      <text x="136" y="${y+8}" fill="#a8b8cc" font-size="10" font-family="monospace">${s.label}</text>
      <text x="136" y="${y+20}" fill="#e2e8f0" font-size="10" font-family="monospace">$${fmt(s.val)} (${pct}%)</text>`;
  }).join('');

  div.innerHTML = `<svg viewBox="0 0 260 110" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:110px;">
    ${paths}
    <text x="${cx}" y="${cy+4}" text-anchor="middle" fill="#e2e8f0" font-size="9" font-family="monospace" font-weight="bold">$${fmt(total)}</text>
    ${legend}
  </svg>`;
};


function renderHistory() {
  const G = window.G; if(!G) return;
  const closed = G.trades().filter(t=>t.status==='closed');
  let filtered = getFilteredHistoryRows('history');
  // Charts use all closed trades
  renderHistCharts(closed);
  const wins = filtered.filter(t=>(t.pnl||0)>0).length;
  const totPnl = filtered.reduce((s,t)=>s+(t.pnl||0),0);
  document.getElementById('histStats').textContent = filtered.length+' trades · WR: '+(filtered.length?Math.round(wins/filtered.length*100):0)+'% · PnL: '+(totPnl>=0?'+':'')+'$'+fmt(Math.abs(totPnl));
  // Trader filter
  const traders = [...new Set(closed.map(t=>t.traderName).filter(Boolean))];
  const ftEl = document.getElementById('filtTrader');
  if(ftEl){ const cur=ftEl.value; ftEl.innerHTML='<option value="">Trader</option>'+traders.map(n=>'<option'+(n===cur?' selected':'')+'>'+n+'</option>').join(''); }
  const tbody = document.getElementById('histTbody');
  if (!filtered.length) { tbody.innerHTML='<tr><td colspan="13"><div class="empty"><div class="empty-text">Sin trades cerrados</div></div></td></tr>'; return; }
  // Sortable headers
  const si = col => _histSort.col===col?(_histSort.dir===1?'↑':'↓'):'';
  const thead = tbody.closest('table')?.querySelector('thead tr');
  if(thead) thead.innerHTML=[['ticker','Ticker'],['dir','Dir'],['exchange','Exchange'],['trader','Trader'],['entry','Entry px'],['exit','Exit px'],['pnl','PnL'],['pnlpct','PnL%'],['fentrada','F.Entrada'],['fcierre','F.Cierre'],['result','Resultado'],['notes','Notas'],['','']].map(([col,lbl])=>col?`<th style="cursor:pointer;user-select:none;" onclick="sortHistory('${col}')" title="Ordenar por ${lbl}">${lbl} ${si(col)}</th>`:`<th>${lbl}</th>`).join('');
  tbody.innerHTML = filtered.map(t=>{
    const allNotes=[t.notes,t.closeNotes].filter(Boolean).join(' · ');
    const pnlCls=(t.pnl||0)>=0?'pnl-pos':'pnl-neg';
    const pnlPctCls=(t.pnlPct||0)>=0?'pnl-pos':'pnl-neg';
    const dirBadge=t.dir==='long'?'bl':t.dir==='short'?'bs':'bsp';
    const resBadge=(t.pnl||0)>=0?'bl':'bs';
    const resLabel=(t.pnl||0)>=0?'WIN':'LOSS';
    return `<tr style="cursor:pointer;" onclick="toggleHistNote('note-${t.id}')">
      <td><strong>${t.ticker||'—'}</strong></td>
      <td><span class="badge ${dirBadge}">${(t.dir||'').toUpperCase()}</span></td>
      <td style="color:var(--t2);">${t.exchange?.toUpperCase()||'—'}</td>
      <td style="color:var(--t2);">${t.traderName||'—'}</td>
      <td style="font-family:var(--mono);">$${fmtPx(t.entry)}</td>
      <td style="font-family:var(--mono);">${t.closePrice?'$'+fmtPx(t.closePrice):'—'}</td>
      <td class="${pnlCls}">${t.pnl!=null?(t.pnl>=0?'+':'-')+'$'+fmt(Math.abs(t.pnl)):'—'}</td>
      <td class="${pnlPctCls}">${t.pnlPct!=null?fmtP(t.pnlPct):'—'}</td>
      <td style="color:var(--t3);font-size:10px;">${t.createdAt?fmtD(t.createdAt):'—'}</td>
      <td style="color:var(--t3);font-size:10px;">${fmtD(t.closeDate)}</td>
      <td><span class="badge ${resBadge}">${resLabel}</span></td>
      <td style="color:var(--t2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;">${allNotes||'—'}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap;">
        <button class="btn sm" onclick="openEditTrade('${t.id}')">✎</button>
        <button class="btn dan sm" onclick="deleteTrade('${t.id}')">✕</button>
      </td>
    </tr>${allNotes?`<tr id="note-${t.id}" style="display:none;"><td colspan="13" style="background:var(--bg3);padding:10px 12px;font-size:11px;color:var(--t2);border-left:2px solid var(--border2);">${allNotes}</td></tr>`:''}`;
  }).join('');
}
// ── Traders page ───────────────────────────────────────────────────────────
function renderTraders() {
  const G = window.G; if(!G) return;
  const tList  = G.traders();
  const trList = G.trades();
  const c = document.getElementById('traderCards');
  if (!tList.length) {
    c.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><div class="empty-text">Sin traders cargados</div></div>`;
    return;
  }
  c.innerHTML = tList.map(t => {
    const tt     = trList.filter(x=>x.traderId===t.id);
    const cl     = tt.filter(x=>x.status==='closed');
    const wins   = cl.filter(x=>(x.pnl||0)>0).length;
    const totPnl = cl.reduce((s,x)=>s+(x.pnl||0),0);
    return `<div class="card">
      <div class="fxb" style="margin-bottom:12px;">
        <div><div style="font-family:var(--mono);font-size:15px;font-weight:600;">${t.name}</div>${t.channel?`<div style="font-size:11px;color:var(--t2);margin-top:2px;">${t.channel}</div>`:''}</div>
        <div class="fx" style="gap:6px;">
          <button class="btn sm" onclick="openTraderModal('${t.id}')">Editar</button>
          <button class="btn dan sm" onclick="deleteTrader('${t.id}')">✕</button>
        </div>
      </div>
      <div class="g3" style="gap:8px;margin-bottom:10px;">
        <div style="text-align:center;background:var(--bg3);border-radius:var(--r);padding:10px;"><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">TRADES</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;">${tt.length}</div></div>
        <div style="text-align:center;background:var(--bg3);border-radius:var(--r);padding:10px;"><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">WIN RATE</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;" class="${cl.length&&wins/cl.length>=.5?'pnl-pos':'pnl-neg'}">${cl.length?Math.round(wins/cl.length*100)+'%':'—'}</div></div>
        <div style="text-align:center;background:var(--bg3);border-radius:var(--r);padding:10px;"><div style="font-size:9px;color:var(--t3);font-family:var(--mono);">PNL</div><div style="font-family:var(--mono);font-size:18px;font-weight:600;" class="${totPnl>=0?'pnl-pos':'pnl-neg'}">${cl.length?(totPnl>=0?'+':'')+fmt(totPnl):'—'}</div></div>
      </div>
      ${t.notes?`<div style="font-size:11px;color:var(--t2);">${t.notes}</div>`:''}
    </div>`;
  }).join('');
}

// ── Toggle history note row ────────────────────────────────────────────────
window.toggleHistNote = id => {
  const el = document.getElementById(id);
  if(el) el.style.display = el.style.display==='none'?'table-row':'none';
};

// ── Edit trade ─────────────────────────────────────────────────────────────
let editDir = 'long';
const EDIT_CHANGE_REASONS = [
  'Actualizacion del trader',
  'Ajuste tecnico',
  'Reduccion de riesgo',
  'Subi SL',
  'Baje SL',
  'Movi TP',
  'Cierre emocional',
  'Toma de ganancia manual',
  'Invalidacion',
  'Error de carga',
  'Cambio de contexto',
  'Otro'
];

window.toggleEditChangeReason = btn => btn?.classList?.toggle('selected');

function renderEditChangeReasons() {
  const chips = document.getElementById('eChangeReasonChips');
  const note = document.getElementById('eChangeReasonNote');
  if (!chips) return;
  chips.innerHTML = EDIT_CHANGE_REASONS.map(reason => `
    <button type="button" class="review-chip warn" data-edit-change-reason="${dashSafe(reason)}" onclick="toggleEditChangeReason(this)">${dashSafe(reason)}</button>
  `).join('');
  if (note) note.value = '';
}

function numberish(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100000000) / 100000000 : (v || '');
}

function firestoreSafeValue(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(firestoreSafeValue);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const cleaned = {};
    Object.entries(value).forEach(([key, val]) => {
      cleaned[key] = firestoreSafeValue(val);
    });
    return cleaned;
  }
  return value;
}

function firestoreSafeObject(obj={}) {
  const cleaned = firestoreSafeValue(obj);
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) ? cleaned : {};
}

function invalidationComparable(list) {
  return JSON.stringify((Array.isArray(list) ? list : []).map(x => ({
    key: x.key || '',
    price: numberish(x.price),
    side: x.side || 'up',
    note: x.note || '',
  })));
}

function changedTradeFields(before={}, after={}) {
  const fields = [
    ['dir','direccion'],
    ['exchange','exchange'],
    ['leverage','apalancamiento'],
    ['entry','entry'],
    ['sl','stop loss'],
    ['liquidation','liquidacion'],
    ['risk','riesgo'],
    ['posSize','tamano'],
    ['tp1','tp1'],
    ['tp1pct','tp1 %'],
    ['tp2','tp2'],
    ['tp2pct','tp2 %'],
    ['tp3','tp3'],
    ['tp3pct','tp3 %'],
    ['traderId','trader'],
  ];
  const changes = fields
    .map(([key,label]) => ({ key, label, from: firestoreSafeValue(before?.[key]), to: firestoreSafeValue(after?.[key]) }))
    .filter(c => numberish(c.from) !== numberish(c.to));
  if (invalidationComparable(before?.invalidations) !== invalidationComparable(after?.invalidations)) {
    changes.push({
      key:'invalidations',
      label:'invalidacion',
      from: firestoreSafeValue(before?.invalidations || []),
      to: firestoreSafeValue(after?.invalidations || []),
    });
  }
  return changes;
}

function getEditChangeAudit(before={}, after={}) {
  const changes = changedTradeFields(before, after);
  const reasonTags = [...document.querySelectorAll('[data-edit-change-reason].selected')]
    .map(x => x.dataset.editChangeReason)
    .filter(Boolean);
  const note = document.getElementById('eChangeReasonNote')?.value?.trim() || '';
  if (!changes.length && !reasonTags.length && !note) return null;
  return firestoreSafeObject({
    at: new Date().toISOString(),
    type: 'edit',
    reasonTags: [...new Set(reasonTags)],
    note,
    fields: changes,
    originalPlanSnapshot: before?.originalPlan || window.buildOriginalTraderPlan?.(before) || null,
  });
}

window.setEditDir = d => {
  editDir = d;
  document.querySelectorAll('[data-ed]').forEach(b=>{
    b.className='dir-btn';
    if(b.dataset.ed===d) b.classList.add(d==='long'?'al':d==='short'?'as':'asp');
  });
};

window.openEditTrade = id => {
  // Find in manual trades or exchange positions
  let t = (window.G?.trades()||[]).find(x=>x.id===id);

  // If it's a closed trade (history), open the directTradeModal pre-filled
  if (t?.status === 'closed' || t?.status === 'pending_review') {
    window._editDirectId = id;
    // Fill traders dropdown
    const G = window.G;
    const sel = document.getElementById('dtTrader');
    if (sel && G) {
      sel.innerHTML = '<option value="">— ninguno —</option>' +
        G.traders().map(tr=>`<option value="${tr.id}"${tr.id===t.traderId?' selected':''}>${tr.name}</option>`).join('');
    }
    // Pre-fill fields
    document.getElementById('dtTicker').value    = t.ticker||'';
    document.getElementById('dtDir').value       = t.dir||'long';
    document.getElementById('dtExchange').value  = t.exchange||'MANUAL';
    document.getElementById('dtLev').value       = t.leverage||1;
    document.getElementById('dtEntry').value     = t.entry||'';
    document.getElementById('dtExit').value      = t.closePrice||'';
    document.getElementById('dtSize').value      = t.marginSize ?? (t.dir==='spot' ? (t.posSize||'') : ((t.posSize||0)/(t.leverage||1) || ''));
    const dtPnlEl = document.getElementById('dtPnl');
    if (dtPnlEl) {
      dtPnlEl.value = t.pnl ?? '';
      dtPnlEl.dataset.originalPnl = t.pnl != null ? String(t.pnl) : '';
      dtPnlEl.dataset.manual = '';
    }
    document.getElementById('dtOpenDate').value  = t.createdAt ? t.createdAt.split('T')[0] : '';
    document.getElementById('dtCloseDate').value = t.closeDate||'';
    document.getElementById('dtNotes').value     = [t.notes, t.closeNotes].filter(Boolean).join(' · ')||'';
    // Change title and button to "edit" mode
    document.querySelector('#directTradeModal .modal-title').textContent = '✎ Editar trade';
    document.getElementById('dtSaveBtn').textContent = 'Guardar cambios';
    window._directTradeEditId = id;
    window.updateDirectTradeSizeLabel?.();
    openModal('directTradeModal');
    return;
  }
  const fromExchange = t?.exchangeSource || exchangePositions.some(p=>p.exchangeId===id||p.id===id);

  if(!t && !fromExchange){ toast('Trade no encontrado','error'); return; }
  window._editTradeId = id;
  window._editFromExchange = fromExchange;
  editDir = t?.dir||'long';

  // Trader dropdown always available
  const traders = window.G?.traders()||[];
  document.getElementById('eTrader').innerHTML =
    '<option value="">— Sin trader —</option>' +
    traders.map(tr=>`<option value="${tr.id}"${tr.id===t?.traderId?' selected':''}>${tr.name}</option>`).join('');
  document.getElementById('eNotes').value = t?.notes||'';

  if(fromExchange) {
    // Exchange trade: only trader, notes and liquidation override editable
    // Show read-only info + editable fields
    document.getElementById('editTradeModal').querySelector('.modal-title').textContent = '✎ Editar trade (exchange)';
    // Disable price fields
    ['eTicker','eExchange','eLev','eEntry','eSL','eRisk','eTP1','eTP1pct','eTP2','eTP2pct','eTP3','eTP3pct'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){ el.disabled=true; el.style.opacity='0.4'; el.value=t?.[id.replace('e','').toLowerCase()]||''; }
    });
    const liqEl = document.getElementById('eLiquidation');
    if(liqEl){
      liqEl.disabled=false; liqEl.style.opacity='';
      liqEl.value=t?.liquidation||'';
      liqEl.dataset.userEdited = '0';
      liqEl.dataset.manualLiquidation = isManualLiquidation(t) ? '1' : '0';
      liqEl.oninput = () => { liqEl.dataset.userEdited = '1'; };
    }
    // Direction buttons
    document.querySelectorAll('[data-ed]').forEach(b=>{ b.className='dir-btn'; b.disabled=true; b.style.opacity='0.4'; });
    // Show notice
    document.getElementById('eNotes').placeholder = 'Notas personales del trade...';
  } else {
    // Manual trade: all fields editable
    document.getElementById('editTradeModal').querySelector('.modal-title').textContent = '✎ Editar trade';
    ['eTicker','eExchange','eLev','eEntry','eSL','eLiquidation','eRisk','eTP1','eTP1pct','eTP2','eTP2pct','eTP3','eTP3pct','eInv1','eInv1Side','eInv2','eInv2Side','eInvNote'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){ el.disabled=false; el.style.opacity=''; }
    });
    document.querySelectorAll('[data-ed]').forEach(b=>{ b.disabled=false; b.style.opacity=''; });

    // Fill form
    document.getElementById('eTicker').value   = t?.ticker||'';
    document.getElementById('eExchange').value = t?.exchange||'';
    document.getElementById('eLev').value      = t?.leverage||1;
    document.getElementById('eEntry').value    = t?.entry||'';
    document.getElementById('eSL').value       = t?.sl||'';
    const liqEl = document.getElementById('eLiquidation');
    if (liqEl) {
      const liqDisplay = t?.liquidation || estimatedLiquidationPrice(t) || '';
      liqEl.value = liqDisplay;
      liqEl.dataset.userEdited = '0';
      liqEl.dataset.manualLiquidation = isManualLiquidation(t) ? '1' : '0';
      liqEl.oninput = () => { liqEl.dataset.userEdited = '1'; };
    }
    document.getElementById('eRisk').value     = t?.risk||'';
    document.getElementById('eSize').value     = t?.posSize||'';
    document.getElementById('eDate').value     = t?.createdAt ? t.createdAt.split('T')[0] : '';
    document.getElementById('eTP1').value      = t?.tp1||'';
    document.getElementById('eTP1pct').value   = t?.tp1pct||33;
    document.getElementById('eTP2').value      = t?.tp2||'';
    document.getElementById('eTP2pct').value   = t?.tp2pct||33;
    document.getElementById('eTP3').value      = t?.tp3||'';
    document.getElementById('eTP3pct').value   = t?.tp3pct||34;
    const invs = tradeInvalidations(t);
    document.getElementById('eInv1').value = invs[0]?.price || '';
    document.getElementById('eInv1Side').value = invs[0]?.side || 'up';
    document.getElementById('eInv2').value = invs[1]?.price || '';
    document.getElementById('eInv2Side').value = invs[1]?.side || 'up';
    document.getElementById('eInvNote').value = invs.find(x=>x.note)?.note || '';

    document.querySelectorAll('[data-ed]').forEach(b=>{
      b.className='dir-btn';
      if(b.dataset.ed===editDir) b.classList.add(editDir==='long'?'al':editDir==='short'?'as':'asp');
    });
  }

  const finalInvs = tradeInvalidations(t);
  if (document.getElementById('eInv1')) {
    document.getElementById('eInv1').disabled = false;
    document.getElementById('eInv1Side').disabled = false;
    document.getElementById('eInv2').disabled = false;
    document.getElementById('eInv2Side').disabled = false;
    document.getElementById('eInvNote').disabled = false;
    document.getElementById('eInv1').style.opacity = '';
    document.getElementById('eInv1Side').style.opacity = '';
    document.getElementById('eInv2').style.opacity = '';
    document.getElementById('eInv2Side').style.opacity = '';
    document.getElementById('eInvNote').style.opacity = '';
    document.getElementById('eInv1').value = finalInvs[0]?.price || '';
    document.getElementById('eInv1Side').value = finalInvs[0]?.side || 'up';
    document.getElementById('eInv2').value = finalInvs[1]?.price || '';
    document.getElementById('eInv2Side').value = finalInvs[1]?.side || 'up';
    document.getElementById('eInvNote').value = finalInvs.find(x=>x.note)?.note || '';
  }

  renderEditAlertState(t);
  renderEditChangeReasons();
  openModal('editTradeModal');
};

window.saveEditTrade = async () => {
  const id = window._editTradeId;
  if(!id){ toast('Error: trade no identificado','error'); return; }

  const traderId   = document.getElementById('eTrader').value;
  const traders    = window.G?.traders()||[];
  const traderName = traders.find(tr=>tr.id===traderId)?.name||'';
  const notes      = document.getElementById('eNotes').value;
  const invalidations = readInvalidationFields('e');
  const existingBeforeEdit = (window.G?.trades()||[]).find(t=>t.id===id) || {};
  const previousInvalidations = tradeInvalidations(existingBeforeEdit);

  // Exchange trade: only update trader, notes and liquidation override
  if(window._editFromExchange) {
    try {
      const liquidationOverride = parseFloat(document.getElementById('eLiquidation').value)||0;
      const originalPlan = existingBeforeEdit.originalPlan || window.buildOriginalTraderPlan?.(existingBeforeEdit) || null;
      const nextTrade = { ...existingBeforeEdit, id, traderId, traderName, notes, liquidation: liquidationOverride || null, liquidationManual: !!liquidationOverride, invalidations, ...(originalPlan ? { originalPlan } : {}) };
      const changeAudit = getEditChangeAudit(existingBeforeEdit, nextTrade);
      await window._fb.updateDoc(window._fb.doc(window._fb.db,'trades',id), firestoreSafeObject({
        traderId, traderName, notes, liquidation: liquidationOverride || null, liquidationManual: !!liquidationOverride, invalidations,
        ...(originalPlan ? { originalPlan } : {}),
        ...(changeAudit ? {
          changeEvents: [...(Array.isArray(existingBeforeEdit.changeEvents) ? existingBeforeEdit.changeEvents : []), changeAudit],
          lastChangeReasonTags: changeAudit.reasonTags,
          lastChangedAt: changeAudit.at,
        } : {}),
        updatedAt:new Date().toISOString()
      }));
      await resetInvalidationAlertsIfChanged(id, previousInvalidations, invalidations);
      await applyEditAlertState(id, { ...existingBeforeEdit, id, traderId, traderName, notes, liquidation: liquidationOverride || null, liquidationManual: !!liquidationOverride, invalidations });
      // Also update local exchange position
      const pos = exchangePositions.find(p=>p.exchangeId===id||p.id===id);
      if(pos){ pos.traderId=traderId; pos.traderName=traderName; pos.notes=notes; pos.liquidation=liquidationOverride || null; pos.liquidationManual=!!liquidationOverride; pos.invalidations=invalidations; }
      await window._loadTrades();
      closeModal('editTradeModal');
      renderPositions();
      renderHistory();
      toast('Trade actualizado.');
    } catch(e){ toast('Error: '+e.message,'error'); }
    return;
  }

  const ticker   = document.getElementById('eTicker').value.trim().toUpperCase();
  const exchange = document.getElementById('eExchange').value.trim().toUpperCase();
  const lev      = parseInt(document.getElementById('eLev').value)||1;
  const entry    = parseFloat(document.getElementById('eEntry').value)||0;
  const sl       = parseFloat(document.getElementById('eSL').value)||0;
  const risk     = parseFloat(document.getElementById('eRisk').value)||0;
  const tp1      = parseFloat(document.getElementById('eTP1').value)||0;
  const tp1pct   = parseFloat(document.getElementById('eTP1pct').value)||33;
  const tp2      = parseFloat(document.getElementById('eTP2').value)||0;
  const tp2pct   = parseFloat(document.getElementById('eTP2pct').value)||33;
  const tp3      = parseFloat(document.getElementById('eTP3').value)||0;
  const tp3pct   = parseFloat(document.getElementById('eTP3pct').value)||34;
  const eDate = document.getElementById('eDate').value;
  if(!ticker||!entry){ toast('Completá ticker y entry como mínimo.','error'); return; }

  const existingTrade = existingBeforeEdit;
  const sizeEl = document.getElementById('eSize');
  const manualSize = parseFloat(sizeEl?.value)||0;
  const slDist = sl && entry ? Math.abs(sl-entry)/entry : 0;
  const isOpenPosition = ['active','zombie'].includes(existingTrade.status);
  const derivedSize = manualSize || ((risk && slDist) ? Math.round(risk/slDist*100)/100 : (risk ? Math.round((editDir === 'spot' ? risk : risk * lev)*100)/100 : 0));
  const posSize = isOpenPosition
    ? (manualSize || existingTrade.posSize || 0)
    : derivedSize;
  const calcRisk = slDist && posSize ? Math.round(posSize*slDist*100)/100 : risk;
  const liqState = editLiquidationState(existingTrade, { dir:editDir, entry, leverage:lev, exchange });
  const liquidation = liqState.liquidation;
  const liquidationManual = liqState.liquidationManual;

  try {
    const originalPlan = existingTrade.originalPlan || window.buildOriginalTraderPlan?.(existingTrade) || null;
    const nextTrade = {
      ...existingTrade, id, ticker, exchange, leverage:lev, dir:editDir, entry, sl,
      liquidation: liquidation || null, liquidationManual, risk: calcRisk, posSize,
      tp1, tp1pct, tp2, tp2pct, tp3, tp3pct,
      notes, traderId, traderName, invalidations,
      ...(originalPlan ? { originalPlan } : {}),
    };
    const changeAudit = getEditChangeAudit(existingTrade, nextTrade);
    await window._fb.updateDoc(window._fb.doc(window._fb.db,'trades',id), firestoreSafeObject({
      ticker, exchange, leverage:lev, dir:editDir,
      entry, sl, liquidation: liquidation || null, liquidationManual, risk: calcRisk, posSize,
      ...(eDate ? { createdAt: eDate+'T00:00:00.000Z' } : {}),
      tp1, tp1pct, tp2, tp2pct, tp3, tp3pct,
      notes, traderId, traderName, invalidations,
      ...(originalPlan ? { originalPlan } : {}),
      ...(changeAudit ? {
        changeEvents: [...(Array.isArray(existingTrade.changeEvents) ? existingTrade.changeEvents : []), changeAudit],
        lastChangeReasonTags: changeAudit.reasonTags,
        lastChangedAt: changeAudit.at,
      } : {}),
      updatedAt: new Date().toISOString(),
    }));
    await resetInvalidationAlertsIfChanged(id, previousInvalidations, invalidations);
    await applyEditAlertState(id, { ...existingTrade, id, ticker, exchange, leverage:lev, dir:editDir, entry, sl, liquidation: liquidation || null, liquidationManual, risk: calcRisk, posSize, tp1, tp1pct, tp2, tp2pct, tp3, tp3pct, notes, traderId, traderName, invalidations });
    await window._loadTrades();
    closeModal('editTradeModal');
    // Re-render current page
    ['dashPage','watchPage','ordersPage','posPage','mapPage','histPage'].forEach(pid=>{
      const el=document.getElementById(pid);
      if(el&&el.style.display!=='none'){
        const fn={dashPage:renderDashboard,watchPage:renderWatchlist,ordersPage:renderOrders,posPage:renderPositions,mapPage:renderMap,histPage:renderHistory}[pid];
        if(fn) fn();
      }
    });
    toast('Trade actualizado.');
  } catch(e){ toast('Error: '+e.message,'error'); console.error(e); }
};

// ── Manual trade modal ─────────────────────────────────────────────────────
let manualDir = 'long';
let entryRowId = 0;

window.openManualTrade = () => {
  manualDir = 'long';
  entryRowId = 0;
  document.getElementById('entryRows').innerHTML = '';
  document.getElementById('mAvgLabel').textContent = '';
  ['mTicker','mExchange','mSL','mTP1','mTP2','mTP3','mInv1','mInv2','mInvNote','mNotes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  ['mInv1Side','mInv2Side'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value='up'; });
  document.getElementById('mLev').value = '1';
  document.getElementById('mDate').value = new Date().toISOString().split('T')[0];
  // Reset direction buttons
  document.querySelectorAll('[data-md]').forEach(b=>{
    b.className='dir-btn'; if(b.dataset.md==='long') b.classList.add('al');
  });
  // Fill traders
  const G=window.G;
  if(G) {
    document.getElementById('mTrader').innerHTML='<option value="">— ninguno —</option>'+
      G.traders().map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  }
  addEntryRow();
  openModal('manualTradeModal');
};

window.setMDir = d => {
  manualDir = d;
  document.querySelectorAll('[data-md]').forEach(b=>{
    b.className='dir-btn';
    if(b.dataset.md===d) b.classList.add(d==='long'?'al':d==='short'?'as':'asp');
  });
};

window.addEntryRow = () => {
  entryRowId++;
  const id=entryRowId;
  const row=document.createElement('div');
  row.id='erow'+id;
  row.style.cssText='display:grid;grid-template-columns:1fr 1fr 28px;gap:6px;margin-bottom:6px;align-items:center;';
  row.innerHTML=`
    <input type="number" data-erow-price="${id}" placeholder="Precio entrada" style="font-size:11px;padding:7px 10px;">
    <input type="number" id="esize${id}" placeholder="Capital USD" style="font-size:11px;padding:7px 10px;">
    <button onclick="removeEntryRow(${id})" style="width:28px;height:28px;border-radius:6px;border:0.5px solid var(--red);background:var(--red-dim);color:var(--red);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">×</button>`;
  document.getElementById('entryRows').appendChild(row);
  setTimeout(()=>row.querySelector('input')?.focus(),50);
};

window.removeEntryRow = id => {
  const el=document.getElementById('erow'+id);
  if(el && document.getElementById('entryRows').children.length>1) el.remove();
};

// ── AI Analysis ────────────────────────────────────────────────────────────
let lwCharts = {}; // lightweight chart instances

let aiMarketType = 'spot'; // 'spot' | 'futures'

window.setMarketType = type => {
  aiMarketType = type;
  const sp = document.getElementById('toggleSpot');
  const ft = document.getElementById('toggleFut');
  if(!sp||!ft) return;
  if(type==='spot'){
    sp.style.background='var(--accent)'; sp.style.color='#000';
    ft.style.background='var(--bg3)';    ft.style.color='var(--t2)';
  } else {
    ft.style.background='var(--accent)'; ft.style.color='#000';
    sp.style.background='var(--bg3)';    sp.style.color='var(--t2)';
  }
};

async function fetchOHLCV(symbol, interval, limit=300) {
  // MEXC commodities — use MEXC futures klines
  if(window._aiSource === 'mexc') {
    // symbol is already in MEXC format (e.g. GOLD_USDT) set by selectTicker
    const mexcSym = symbol;
    const ivMap = {'1M':'Month1','1w':'Week1','1d':'Day1','4h':'Hour4','1h':'Min60'};
    const mexcIv = ivMap[interval] || 'Day1';
    try {
      const url = `https://contract.mexc.com/api/v1/contract/kline/${mexcSym}?interval=${mexcIv}&limit=${limit}`;
      const r   = await (PROXY_URL ? window.proxyFetch(url) : fetch(url));
      const text = await r.text();
      let d; try { d = JSON.parse(text); } catch(e) { throw new Error(`MEXC parse error: ${text.slice(0,100)}`); }
      if(d.success && d.data) {
        const data = d.data;
        // MEXC returns arrays: time, open, close, high, low, vol
        const times = data.time || [];
        return times.map((t,i) => ({
          time:   Math.floor(t),
          open:   parseFloat(data.open?.[i] || 0),
          high:   parseFloat(data.high?.[i] || 0),
          low:    parseFloat(data.low?.[i]  || 0),
          close:  parseFloat(data.close?.[i]|| 0),
          volume: parseFloat(data.vol?.[i]  || 0),
        })).filter(c=>c.open>0&&c.close>0);
      } else {
        throw new Error(`MEXC error: ${JSON.stringify(d).slice(0,100)}`);
      }
    } catch(e) { console.warn('MEXC kline error:', e.message); throw e; }
  }

  // Detect non-crypto (no USDT suffix or in stock list)
  const isStock = window._aiSource === 'yahoo' || window._aiType === 'stock' || window._aiType === 'etf' ||
                  window._aiType === 'index' ||
                  (!symbol.endsWith('USDT') && !symbol.endsWith('BUSD') && window._aiSource !== 'mexc');

  if(isStock) {
    // Yahoo Finance via proxy (avoids CORS)
    const ivMap = {'1M':'1mo','1w':'1wk','1d':'1d','4h':'1h','1h':'1h'};
    const rangeMap = {'1M':'10y','1w':'5y','1d':'1y','4h':'3mo','1h':'1mo'};
    const yhIv = ivMap[interval]||'1d';
    const range = rangeMap[interval]||'1y';
    const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yhIv}&range=${range}`;
    try {
      const r = await (PROXY_URL ? window.proxyFetch(yhUrl) : fetch(yhUrl));
      const d = await r.json();
      const res = d.chart?.result?.[0];
      if(!res) throw new Error('Sin datos Yahoo');
      const ts = res.timestamp;
      const q  = res.indicators.quote[0];
      return ts.map((t,i)=>({
        time:t, open:q.open[i]||0, high:q.high[i]||0,
        low:q.low[i]||0, close:q.close[i]||0, volume:q.volume[i]||0
      })).filter(c=>c.open>0&&c.close>0);
    } catch(e) {
      throw new Error(`Yahoo Finance error: ${e.message}`);
    }
  }

  // Crypto: Binance (use proxy to avoid CORS from Vercel)
  const base = aiMarketType==='futures'
    ? 'https://fapi.binance.com/fapi/v1/klines'
    : 'https://api.binance.com/api/v3/klines';
  const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const fetchFn = PROXY_URL ? window.proxyFetch : fetch;
  const r = await fetchFn(url);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.map(k=>({
    time:   Math.floor(k[0]/1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

function calcOBV(candles) {
  let obv = 0;
  return candles.map((c,i)=>{
    if(i>0){
      if(c.close>candles[i-1].close) obv+=c.volume;
      else if(c.close<candles[i-1].close) obv-=c.volume;
    }
    return {time:c.time, value:obv};
  });
}

// ── Indicator calculations ───────────────────────────────────────────────────
function calcEMA(candles, period) {
  const k = 2/(period+1);
  let ema = candles[0].close;
  return candles.map((c,i) => {
    if(i===0){ ema=c.close; return {time:c.time,value:ema}; }
    ema = c.close*k + ema*(1-k);
    return {time:c.time,value:ema};
  });
}

function calcRSI(candles, period=14) {
  const result=[];
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){
    const d=candles[i].close-candles[i-1].close;
    if(d>0) gains+=d; else losses+=Math.abs(d);
  }
  let avgG=gains/period, avgL=losses/period;
  result.push({time:candles[period].time,value:avgL===0?100:100-(100/(1+avgG/avgL))});
  for(let i=period+1;i<candles.length;i++){
    const d=candles[i].close-candles[i-1].close;
    avgG=(avgG*(period-1)+(d>0?d:0))/period;
    avgL=(avgL*(period-1)+(d<0?Math.abs(d):0))/period;
    result.push({time:candles[i].time,value:avgL===0?100:100-(100/(1+avgG/avgL))});
  }
  return result;
}

// Chart config helper
const lwCfg = (height) => ({
  width: 0, // will be set by container
  height,
  layout:{ background:{color:'transparent'}, textColor:'#6a7888' },
  grid:{ vertLines:{color:'rgba(255,255,255,0.03)'}, horzLines:{color:'rgba(255,255,255,0.03)'} },
  crosshair:{ mode:1 },
  rightPriceScale:{ borderColor:'rgba(255,255,255,0.08)', scaleMargins:{top:0.05,bottom:0.05} },
  timeScale:{ borderColor:'rgba(255,255,255,0.08)', timeVisible:true, visible:false },
  handleScroll:false, handleScale:false,
});

function makeChart(el, height) {
  const ch = LightweightCharts.createChart(el, {...lwCfg(height), width:el.clientWidth||400});
  new ResizeObserver(()=>ch.applyOptions({width:el.clientWidth})).observe(el);
  return ch;
}

async function renderTFCharts(tfKey, symbol, interval) {
  const csEl  = document.getElementById('cs'+tfKey);
  const volEl = document.getElementById('vol'+tfKey);
  const obvEl = document.getElementById('obv'+tfKey);
  const rsiEl = document.getElementById('rsi'+tfKey);
  if(!csEl) return;

  // Clear old charts
  ['cs','vol','obv','rsi'].forEach(p=>{
    const k=p+tfKey;
    if(lwCharts[k]){try{lwCharts[k].remove();}catch(e){} delete lwCharts[k];}
    const el=document.getElementById(k);
    if(el) el.innerHTML='';
  });

  try {
    // More candles so EMA200 always renders
    const limit = tfKey==='1M'?48:tfKey==='1W'?150:tfKey==='1D'?300:250;
    const candles = await fetchOHLCV(symbol, interval, limit);
    if(!candles.length) throw new Error('Sin datos');

    // ── Candlestick chart with EMAs ───────────────────────────────────────
    const csChart = makeChart(csEl, 220);
    lwCharts['cs'+tfKey] = csChart;

    // Show time axis only on candle chart (top panel)
    csChart.applyOptions({
      timeScale:{ borderColor:'rgba(255,255,255,0.08)', timeVisible:true, visible:true,
        tickMarkFormatter:(t,type,locale)=>{
          const d=new Date(t*1000);
          if(interval==='1w'||interval==='1M') return d.toLocaleDateString('es',{month:'short',year:'2-digit'});
          if(interval==='1d') return d.toLocaleDateString('es',{day:'2-digit',month:'short'});
          return d.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
        }
      }
    });

    // Log scale for weekly and monthly
    if (tfKey === '1W' || tfKey === '1M') {
      csChart.applyOptions({ rightPriceScale:{ mode:1, borderColor:'rgba(255,255,255,0.08)', scaleMargins:{top:0.05,bottom:0.05} } });
    }
    const csSeries = csChart.addCandlestickSeries({
      upColor:'#00c47a', downColor:'#f03d3d',
      borderUpColor:'#00c47a', borderDownColor:'#f03d3d',
      wickUpColor:'#00a85a', wickDownColor:'#c03030',
    });
    csSeries.setData(candles);

    // EMA 20 (yellow) / 50 (blue) / 200 (red) — show last value
    const emaConfigs = [
      {p:20,  color:'rgba(240,200,60,0.9)',  label:'E20'},
      {p:50,  color:'rgba(61,156,240,0.9)',  label:'E50'},
      ...(tfKey !== '1M' ? [{p:200, color:'rgba(240,80,80,0.85)', label:'E200'}] : []),
    ];
    const emaValues = {};
    for(const {p,color,label} of emaConfigs){
      if(candles.length>=p){
        const emaData = calcEMA(candles,p);
        const emaSeries = csChart.addLineSeries({
          color, lineWidth:1,
          priceLineVisible:false,
          lastValueVisible:false, // hide price label to avoid chart clutter
          title:'',
        });
        emaSeries.setData(emaData);
        emaValues[label] = emaData[emaData.length-1]?.value;
      }
    }
    csChart.timeScale().fitContent();

    // ── Volume chart (no time axis) ────────────────────────────────────────
    const volChart = makeChart(volEl, 80);
    lwCharts['vol'+tfKey] = volChart;
    volChart.applyOptions({timeScale:{visible:false}});
    // Calc avg volume for reference
    const avgVol = candles.slice(-20).reduce((s,c)=>s+c.volume,0)/20;
    const volSeries = volChart.addHistogramSeries({
      priceFormat:{type:'volume'},
      priceScaleId:'right',
      scaleMargins:{top:0.1,bottom:0},
    });
    volSeries.setData(candles.map(c=>({
      time:c.time, value:c.volume,
      // Highlight volume spikes (>2x avg) in brighter color
      color: c.volume>avgVol*2
        ? (c.close>=c.open?'rgba(0,196,122,0.9)':'rgba(240,61,61,0.9)')
        : (c.close>=c.open?'rgba(0,196,122,0.45)':'rgba(240,61,61,0.45)')
    })));
    // Avg volume line
    const avgSeries = volChart.addLineSeries({color:'rgba(255,200,60,0.5)',lineWidth:1,priceLineVisible:false,lastValueVisible:false,lineStyle:2});
    avgSeries.setData(candles.slice(-20).map(c=>({time:c.time,value:avgVol})));
    volChart.timeScale().fitContent();

    // ── OBV chart (no time axis) ───────────────────────────────────────────
    const obvChart = makeChart(obvEl, 80);
    lwCharts['obv'+tfKey] = obvChart;
    const _obvFmt = v => {
      const abs = Math.abs(v), sign = v < 0 ? '-' : '';
      if (abs >= 1e9) return sign+(abs/1e9).toFixed(1)+'B';
      if (abs >= 1e6) return sign+(abs/1e6).toFixed(1)+'M';
      if (abs >= 1e3) return sign+(abs/1e3).toFixed(1)+'K';
      return sign+abs.toFixed(0);
    };
    obvChart.applyOptions({
      timeScale:{visible:false},
      localization:{ priceFormatter: _obvFmt },
    });
    const obvSeries = obvChart.addLineSeries({
      color:'rgba(61,156,240,0.85)', lineWidth:1.5,
      priceLineVisible:false, lastValueVisible:false,
    });
    obvSeries.setData(calcOBV(candles));
    obvChart.timeScale().fitContent();

    // ── RSI chart — show time axis here (bottom panel) ─────────────────────
    const rsiChart = makeChart(rsiEl, 80);
    lwCharts['rsi'+tfKey] = rsiChart;
    rsiChart.applyOptions({
      timeScale:{ borderColor:'rgba(255,255,255,0.08)', timeVisible:true, visible:true,
        tickMarkFormatter:(t,type,locale)=>{
          const d=new Date(t*1000);
          if(interval==='1w'||interval==='1M') return d.toLocaleDateString('es',{month:'short',year:'2-digit'});
          if(interval==='1d') return d.toLocaleDateString('es',{day:'2-digit',month:'short'});
          return d.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
        }
      }
    });
    const rsiData = calcRSI(candles,14);
    const rsiSeries = rsiChart.addLineSeries({
      color:'rgba(176,96,255,0.85)',lineWidth:1.5,
      priceLineVisible:false, lastValueVisible:true, title:'RSI',
    });
    rsiSeries.setData(rsiData);
    // OB/OS reference lines
    if(rsiData.length){
      [[70,'rgba(240,61,61,0.4)'],[50,'rgba(255,255,255,0.15)'],[30,'rgba(0,196,122,0.4)']].forEach(([v,col])=>{
        const s=rsiChart.addLineSeries({color:col,lineWidth:1,priceLineVisible:false,lastValueVisible:false,lineStyle:2});
        s.setData(rsiData.map(d=>({time:d.time,value:v})));
      });
    }
    rsiChart.timeScale().fitContent();

    // Sync all time scales
    const syncTS = (master, slaves) => {
      master.timeScale().subscribeVisibleLogicalRangeChange(range=>{
        if(!range) return;
        slaves.forEach(s=>{ try{s.timeScale().setVisibleLogicalRange(range);}catch(e){} });
      });
    };
    syncTS(csChart, [volChart,obvChart,rsiChart]);

    return {candles, emaValues};
  } catch(e) {
    csEl.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:150px;color:var(--t3);font-family:var(--mono);font-size:11px;">Error: ${e.message}</div>`;
    console.error(tfKey, e);
    return null;
  }
}

// ── Fetch market data (Binance + Fear&Greed) ─────────────────────────────
async function fetchMarketData(symbol) {
  const data = {};
  try {
    // 24h ticker
    const r = await (PROXY_URL?window.proxyFetch:fetch)(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    const d = await r.json();
    data.price     = parseFloat(d.lastPrice);
    data.change24h = parseFloat(d.priceChangePercent);
    data.vol24h    = parseFloat(d.quoteVolume); // in USDT
    data.high24h   = parseFloat(d.highPrice);
    data.low24h    = parseFloat(d.lowPrice);
  } catch(e){}

  try {
    // Funding rate (futures)
    const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
    const d = await r.json();
    if(d[0]) data.fundingRate = parseFloat(d[0].fundingRate)*100;
  } catch(e){}

  try {
    // Open Interest
    const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    const d = await r.json();
    if(d.openInterest) data.openInterest = parseFloat(d.openInterest)*data.price;
  } catch(e){}

  try {
    // Fear & Greed
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const d = await r.json();
    if(d.data?.[0]) { data.fng = parseInt(d.data[0].value); data.fngLabel = d.data[0].value_classification; }
  } catch(e){}

  return data;
}

function renderMarketStrip(symbol, md, emaValues={}, mktType='spot') {
  const strip = document.getElementById('marketStrip');
  if(!strip) return;
  const chgColor = (md.change24h||0)>=0?'var(--accent)':'var(--red)';
  const fngColor = md.fng>=60?'var(--red)':md.fng>=40?'var(--amber)':'var(--accent)';
  const frColor  = (md.fundingRate||0)>0.05?'var(--red)':(md.fundingRate||0)<-0.01?'var(--accent)':'var(--t2)';
  const typeLabel = mktType==='futures'
    ? '<span style="background:var(--amber-dim);color:var(--amber);padding:2px 6px;border-radius:4px;font-size:9px;">FUTUROS</span>'
    : '<span style="background:var(--blue-dim);color:var(--blue);padding:2px 6px;border-radius:4px;font-size:9px;">SPOT</span>';

  const emaStr = Object.entries(emaValues).map(([k,v])=>
    v ? `<span style="color:var(--t3);">${k}: <span style="color:${k==='E20'?'rgba(240,200,60,0.9)':k==='E50'?'rgba(61,156,240,0.9)':'rgba(240,80,80,0.9)'}">$${fmtPx(v)}</span></span>` : ''
  ).join('');

  strip.style.display='flex';
  strip.innerHTML=`
    ${typeLabel}
    <span style="color:var(--t1);font-size:13px;font-weight:600;">${symbol}</span>
    <span style="color:var(--t1);">${md.price?'$'+fmtPx(md.price):'—'}</span>
    ${md.change24h!=null?`<span style="color:${chgColor};">${md.change24h>=0?'+':''}${md.change24h.toFixed(2)}%</span>`:''}
    ${md.high24h?`<span style="color:var(--t3);">H: $${fmtPx(md.high24h)} · L: $${fmtPx(md.low24h)}</span>`:''}
    ${md.vol24h?`<span style="color:var(--t3);">Vol: $${(md.vol24h/1e9).toFixed(2)}B</span>`:''}
    ${emaStr}
    ${md.fundingRate!=null?`<span>FR: <span style="color:${frColor};">${md.fundingRate>=0?'+':''}${md.fundingRate.toFixed(4)}%</span></span>`:''}
    ${md.openInterest?`<span style="color:var(--t3);">OI: $${(md.openInterest/1e9).toFixed(2)}B</span>`:''}
    ${md.fng!=null?`<span>F&G: <span style="color:${fngColor};">${md.fng} · ${md.fngLabel}</span></span>`:''}
  `;
}

window.loadCharts = async () => {
  const rawInput = (document.getElementById('aiSymbol')?.value||'BTCUSDT').trim().toUpperCase();
  const btn = document.getElementById('chartsBtn');
  btn.textContent='↺ Cargando...'; btn.disabled=true;
  document.getElementById('copyStatus').style.display='none';
  // Clear trade overlay if user loads manually
  if(!_analysisTradeData) {
    const panel=document.getElementById('aiTradePanel');
    if(panel) panel.style.display='none';
  }

  // Auto-detect MEXC commodity symbols
  const QUICK_MEXC = {
    OIL:'USOIL_USDT',WTI:'USOIL_USDT',BRENT:'UKOIL_USDT',UKOIL:'UKOIL_USDT',
    USOIL:'USOIL_USDT',GOLD:'XAUT_USDT',ORO:'XAUT_USDT',XAUT:'XAUT_USDT',
    SILVER:'XAG_USDT',PLATA:'XAG_USDT',XAG:'XAG_USDT',
  };
  const quickSym = QUICK_MEXC[rawInput];
  const mexcMatch = quickSym
    ? MEXC_COMMODITIES.find(m => m.sym === quickSym)
    : MEXC_COMMODITIES.find(m =>
        m.sym.toUpperCase() === rawInput ||
        m.sym.toUpperCase().replace(/_USDT$/,'') === rawInput ||
        m.n.toUpperCase().includes(rawInput)
      );
  if(mexcMatch) {
    window._aiSource = 'mexc';
    window._aiType   = 'commodity';
    document.getElementById('aiSymbol').value = mexcMatch.sym;
    setMarketType('futures');
  }

  const symbol = mexcMatch
    ? mexcMatch.sym
    : rawInput.replace(/[^A-Z0-9_]/g,'');

  try {
    // Load all timeframes + market data in parallel
    const [res1M, res1W, res1D, md] = await Promise.all([
      renderTFCharts('1M', symbol, '1M'),
      renderTFCharts('1W', symbol, '1w'),
      renderTFCharts('1D', symbol, '1d'),
      fetchMarketData(symbol),
    ]);
    const [res4H, res1H] = await Promise.all([
      renderTFCharts('4H', symbol, '4h'),
      renderTFCharts('1H', symbol, '1h'),
    ]);

    // Collect EMA values from 1D for the strip
    const ema1D = res1D?.emaValues || {};
    renderMarketStrip(symbol, md, ema1D, aiMarketType);
  } catch(e){ console.error(e); toast('Error cargando charts: '+e.message,'error'); }
  btn.textContent='↺ Cargar'; btn.disabled=false;

  // Draw trade levels if opened from watchlist
  if(_analysisTradeData) {
    renderTradeInfoPanel(_analysisTradeData);
    // Draw price lines on all candlestick charts
    ['1M','1W','1D','4H','1H'].forEach(tf=>{
      const csChart = lwCharts['cs'+tf];
      if(!csChart||!_analysisTradeData.entry) return;
      try {
        const trade = _analysisTradeData;
        const levels = [
          {price:trade.entry, color:'rgba(232,237,243,0.9)', title:'Entry', width:1},
          ...(trade.sl?  [{price:trade.sl,  color:'rgba(240,61,61,0.9)',  title:'SL',  width:1}]:[]),
          ...(trade.tp1? [{price:trade.tp1, color:'rgba(0,196,122,0.7)', title:'TP1', width:1}]:[]),
          ...(trade.tp2? [{price:trade.tp2, color:'rgba(0,196,122,0.85)',title:'TP2', width:1}]:[]),
          ...(trade.tp3? [{price:trade.tp3, color:'rgba(0,196,122,1.0)', title:'TP3', width:1}]:[]),
        ];
        // Get candlestick series to add price lines
        // Use addLineSeries as horizontal reference lines
        // We draw them by creating a series with 2 extreme time points
        const series = lwCharts['cs'+tf+'_candles'] || null;
        // Fallback: add as horizontal line series
        levels.forEach(lvl=>{
          try {
            const ls = csChart.addLineSeries({
              color: lvl.color, lineWidth: lvl.width||1,
              lineStyle: 2, // dashed
              priceLineVisible: true,
              priceLineStyle: 2,
              priceLineColor: lvl.color,
              lastValueVisible: false,  // hide label on price axis to avoid covering candles
              title: '',
              crosshairMarkerVisible: false,
            });
            // Extend line across visible range + extra
            const visible = csChart.timeScale().getVisibleRange();
            if(visible) {
              const pad = Math.round((visible.to - visible.from) * 0.1);
              ls.setData([
                {time: visible.from - pad, value: lvl.price},
                {time: visible.to   + pad, value: lvl.price}
              ]);
            }
            // Add a price line instead for the label — shows on right but doesn't cover candles
            ls.createPriceLine({
              price: lvl.price,
              color: lvl.color,
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: lvl.title,
            });
          } catch(e){}
        });
      } catch(e){ console.warn('Error drawing levels on '+tf, e); }
    });
  }
};

// ── Copy all charts + market data as single image to clipboard ─────────────
window.copyChartsToClipboard = async () => {
  const btn = document.getElementById('copyBtn');
  btn.textContent='⟳ Generando...'; btn.disabled=true;

  try {
    const symbol = (document.getElementById('aiSymbol')?.value||'BTCUSDT').toUpperCase().replace(/[^A-Z]/g,'');
    const grid = document.getElementById('aiChartGrid');
    const strip = document.getElementById('marketStrip');

    // Build a single canvas from all chart canvases
    const gridRect = grid.getBoundingClientRect();
    const stripH = strip.offsetHeight||0;
    const monthly = document.getElementById('monthlyCard');
    const monthlyH = monthly ? Math.round(monthly.getBoundingClientRect().height) + 10 : 0;
    const totalW = Math.round(gridRect.width);
    const totalH = Math.round(gridRect.height) + stripH + 20 + monthlyH;

    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio||1;
    canvas.width  = totalW * dpr;
    canvas.height = totalH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Dark background
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0,0,totalW,totalH);

    // Draw market strip as text
    if(strip.offsetHeight){
      ctx.fillStyle='#161b22';
      ctx.fillRect(0,0,totalW,stripH+8);
      ctx.fillStyle='#a8b8cc';
      ctx.font='11px "Fira Code", monospace';
      ctx.fillText(strip.innerText.replace(/\s+/g,' ').trim(), 10, (stripH/2)+5);
    }

    const offsetY = stripH+10;

    // Collect all LW chart canvases from 2x2 grid
    const chartCanvases = grid.querySelectorAll('canvas');
    chartCanvases.forEach(cv => {
      const r = cv.getBoundingClientRect();
      const gr = grid.getBoundingClientRect();
      const x = r.left - gr.left;
      const y = r.top - gr.top + offsetY;
      try { ctx.drawImage(cv, x, y, r.width, r.height); } catch(e){}
    });

    // Also draw monthly chart (1M) below the grid
    if (monthly) {
      const monthlyCanvases = monthly.querySelectorAll('canvas');
      const monthlyTop = Math.round(gridRect.height) + offsetY + 10;
      monthlyCanvases.forEach(cv => {
        const r  = cv.getBoundingClientRect();
        const mr = monthly.getBoundingClientRect();
        const x  = r.left - mr.left;
        const y  = r.top  - mr.top + monthlyTop;
        try { ctx.drawImage(cv, x, y, r.width, r.height); } catch(e){}
      });
    }

    // Add symbol + timestamp watermark
    ctx.fillStyle='rgba(255,255,255,0.2)';
    ctx.font='12px "Fira Code", monospace';
    ctx.fillText(`${symbol} · ${new Date().toLocaleString('es')} · MAUex`, 10, totalH-8);

    // Copy to clipboard
    canvas.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
        btn.textContent='✅ Copiado!';
        document.getElementById('copyStatus').style.display='block';
        setTimeout(()=>{
          btn.textContent='📋 Copiar para Claude';
          btn.disabled=false;
        },2000);
      } catch(e) {
        // Fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href=url; a.download=`${symbol}_analysis_${Date.now()}.png`; a.click();
        btn.textContent='📋 Copiar para Claude'; btn.disabled=false;
        toast('Portapapeles no disponible — imagen descargada','error');
      }
    },'image/png');
  } catch(e) {
    toast('Error generando imagen: '+e.message,'error');
    btn.textContent='📋 Copiar para Claude'; btn.disabled=false;
    console.error(e);
  }
};



// ══════════════════════════════════════════════════════════════════════════════
// EXCHANGE INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════

// ── Crypto helpers (AES-GCM via WebCrypto) ────────────────────────────────
async function deriveKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: enc.encode('mauex-salt-v1'), iterations:100000, hash:'SHA-256' },
    keyMaterial, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
  );
}

async function encryptData(plaintext, password) {
  const key = await deriveKey(password);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct  = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(plaintext));
  // Combine iv + ciphertext, encode as base64
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv); combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(b64, password) {
  const key  = await deriveKey(password);
  const data = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
  const iv   = data.slice(0,12);
  const ct   = data.slice(12);
  const dec  = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return new TextDecoder().decode(dec);
}

// ── HMAC-SHA256 for request signing ─────────────────────────────────────────
async function hmacSHA256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function hmacSHA256Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── Master password state ─────────────────────────────────────────────────
const MASTER_PASS_SESSION_KEY = 'mauex_mp';
const MASTER_PASS_DEVICE_KEY = 'mauex_mp_remembered';
let _masterPass = sessionStorage.getItem(MASTER_PASS_SESSION_KEY) || localStorage.getItem(MASTER_PASS_DEVICE_KEY) || '';

window.saveMasterPass = () => {
  const p = document.getElementById('masterPass').value;
  if(p.length < 8) { 
    const st=document.getElementById('masterStatus'); 
    if(st){st.textContent='❌ Mínimo 8 caracteres'; st.style.display='block'; st.style.color='var(--red)';}
    return; 
  }
  if(p.length < 8){ toast('Mínimo 8 caracteres.','error'); return; }
  _masterPass = p;
  sessionStorage.setItem(MASTER_PASS_SESSION_KEY, p);
  const st = document.getElementById('masterStatus');
  st.style.display='block'; st.style.color='var(--accent)';
  st.textContent='✅ Contraseña guardada en memoria (sesión actual)';
  toast('Contraseña maestra lista.');
};

window.saveMasterPass2 = () => {
  const p = document.getElementById('masterPass2')?.value || '';
  if(p.length < 8) {
    const st = document.getElementById('masterStatus2');
    if(st){ st.textContent='Mínimo 8 caracteres'; st.style.display='block'; st.style.color='var(--red)'; }
    return;
  }
  _masterPass = p;
  sessionStorage.setItem(MASTER_PASS_SESSION_KEY, p);
  const st = document.getElementById('masterStatus2');
  if(st){ st.textContent='Contraseña guardada en memoria'; st.style.display='block'; st.style.color='var(--accent)'; }
  toast('Contraseña maestra lista.');
};

// ── Save/load exchange keys (Firestore encrypted) ─────────────────────────
window.saveExchangeKeys = async exchange => {
  if(!_masterPass){ toast('Primero guardá tu contraseña maestra.','error'); return; }
  const keyMap = {
    binance: { key: document.getElementById('bnbKey')?.value.trim(),    secret: document.getElementById('bnbSecret')?.value.trim() },
    bybit:   { key: document.getElementById('bybitKey')?.value.trim(),   secret: document.getElementById('bybitSecret')?.value.trim() },
    okx:     { key: document.getElementById('okxKey')?.value.trim(),     secret: document.getElementById('okxSecret')?.value.trim(), passphrase: document.getElementById('okxPass')?.value.trim() },
    mexc:    { key: document.getElementById('mexcKey')?.value.trim(),    secret: document.getElementById('mexcSecret')?.value.trim() },
    kucoin:  { key: document.getElementById('kucoinKey')?.value.trim(),  secret: document.getElementById('kucoinSecret')?.value.trim(), passphrase: document.getElementById('kucoinPass')?.value.trim() },
  };
  const keys = keyMap[exchange];
  if(!keys){ toast(`Exchange ${exchange} no reconocido.`,'error'); return; }
  if(!keys.key || !keys.secret || (['okx','kucoin'].includes(exchange) && !keys.passphrase)){ toast('Completá Key, Secret y Passphrase si aplica.','error'); return; }
  try {
    const encrypted = await encryptData(JSON.stringify(keys), _masterPass);
    if(window.G?._saveExchangeKey) await window.G._saveExchangeKey(exchange, encrypted);
    updateExchangeStatus(exchange, 'saved');
    toast(`${exchange.toUpperCase()} guardado correctamente.`);
  } catch(e){ toast('Error encriptando: '+e.message,'error'); }
};

// Modal version — reads from modal fields (id suffix '2')
window.saveExchangeKeys2 = async exchange => {
  if(!_masterPass){ toast('Primero guardá tu contraseña maestra.','error'); return; }
  const keyMap = {
    binance: { key: document.getElementById('bnbKey2')?.value.trim(),    secret: document.getElementById('bnbSecret2')?.value.trim() },
    bybit:   { key: document.getElementById('bybitKey2')?.value.trim(),   secret: document.getElementById('bybitSecret2')?.value.trim() },
    okx:     { key: document.getElementById('okxKey2')?.value.trim(),     secret: document.getElementById('okxSecret2')?.value.trim(), passphrase: document.getElementById('okxPass2')?.value.trim() },
    mexc:    { key: document.getElementById('mexcKey2')?.value.trim(),    secret: document.getElementById('mexcSecret2')?.value.trim() },
    kucoin:  { key: document.getElementById('kucoinKey2')?.value.trim(),  secret: document.getElementById('kucoinSecret2')?.value.trim(), passphrase: document.getElementById('kucoinPass2')?.value.trim() },
  };
  const keys = keyMap[exchange];
  if(!keys){ toast(`Exchange ${exchange} no reconocido.`,'error'); return; }
  if(!keys.key || !keys.secret || (['okx','kucoin'].includes(exchange) && !keys.passphrase)){ toast('Completá Key, Secret y Passphrase si aplica.','error'); return; }
  try {
    const encrypted = await encryptData(JSON.stringify(keys), _masterPass);
    if(window.G?._saveExchangeKey) await window.G._saveExchangeKey(exchange, encrypted);
    updateExchangeStatus(exchange, 'saved');
    window.syncApiModalStatus?.();
    toast(`${exchange.toUpperCase()} guardado correctamente.`);
  } catch(e){ toast('Error encriptando: '+e.message,'error'); }
};

// Render historial content inside dashboard tab
window.renderHistFiltersAndTable = (filterId, tableId) => {
  const filtersEl = document.getElementById(filterId);
  const tableEl   = document.getElementById(tableId);
  if (!filtersEl || !tableEl) return;

  const G = window.G; if (!G) return;
  const trades = G.trades().filter(t => t.status === 'closed');

  // Render filters
  filtersEl.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      <input type="text" id="dashFiltTicker" placeholder="Ticker..." style="width:120px;" oninput="renderDashHistory()">
      <select id="dashFiltDir" onchange="renderDashHistory()"><option value="">Dirección</option><option>long</option><option>short</option><option>spot</option></select>
      <select id="dashFiltTrader" onchange="renderDashHistory()"><option value="">Trader</option>${[...new Set(trades.map(t=>t.traderName).filter(Boolean))].map(n=>`<option>${n}</option>`).join('')}</select>
      <select id="dashFiltResult" onchange="renderDashHistory()"><option value="">Resultado</option><option value="win">Win</option><option value="loss">Loss</option></select>
    </div>`;

  renderDashHistory();
};

window.renderDashHistory = () => {
  const tableEl = document.getElementById('dashHistTable');
  if (!tableEl) return;
  const G = window.G; if (!G) return;

  let trades = getFilteredHistoryRows('dashboard');
  const dashStats = document.getElementById('dashHistStats');
  if(dashStats) {
    const wins = trades.filter(t=>(t.pnl||0)>0).length;
    const totPnl = trades.reduce((s,t)=>s+(t.pnl||0),0);
    dashStats.textContent = trades.length+' trades · WR: '+(trades.length?Math.round(wins/trades.length*100):0)+'% · PnL: '+(totPnl>=0?'+':'')+'$'+fmt(Math.abs(totPnl));
  }

  if (!trades.length) {
    tableEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--t3);font-family:var(--mono);font-size:12px;">Sin trades cerrados</div>`;
    return;
  }

  const si = col => _dashHistSort.col===col?(_dashHistSort.dir===1?'↑':'↓'):'';
  tableEl.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <table class="tbl" style="min-width:720px;">
      <thead><tr>${[['ticker','Ticker'],['dir','Dir'],['exchange','Exchange'],['trader','Trader'],['entry','Entry'],['exit','Exit'],['pnl','PnL'],['pnlpct','PnL%'],['fcierre','Fecha cierre']].map(([col,lbl])=>`<th style="cursor:pointer;user-select:none;" onclick="sortDashHistory('${col}')" title="Ordenar por ${lbl}">${lbl} ${si(col)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${trades.map(t => {
        const pnl = t.pnl || 0;
        const cls = pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
        return `<tr>
          <td style="font-family:var(--mono);font-weight:600;">${t.ticker||'—'}</td>
          <td><span class="badge ${t.dir==='long'?'bl':t.dir==='short'?'bs':'bsp'}">${(t.dir||'').toUpperCase()}</span></td>
          <td style="font-size:11px;color:var(--t2);">${t.exchange||'—'}</td>
          <td style="font-size:11px;color:var(--t2);">${t.traderName||'—'}</td>
          <td style="font-family:var(--mono);">$${t.entry||'—'}</td>
          <td style="font-family:var(--mono);">$${t.closePrice||t.exitPrice||t.exit||'—'}</td>
          <td class="${cls}" style="font-family:var(--mono);">${pnl>=0?'+':''}$${Math.abs(pnl).toFixed(0)}</td>
          <td class="${cls}" style="font-family:var(--mono);">${t.pnlPct!=null?(t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(1)+'%':'—'}</td>
          <td style="font-size:11px;color:var(--t2);">${fmtD(historyCloseDateOf(t))}</td>
          <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:right;">
            <button class="btn sm" onclick="openEditTrade('${t.id}')">✎</button>
            <button class="btn dan sm" onclick="deleteTrade('${t.id}')">✕</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
};

window.clearExchangeKeys = async exchange => {
  if(!confirm(`¿Eliminar las keys de ${exchange}?`)) return;
  if(window.G?._saveExchangeKey) await window.G._saveExchangeKey(exchange, null);
  updateExchangeStatus(exchange, 'none');
  toast(`Keys de ${exchange} eliminadas.`);
};

function updateExchangeStatus(exchange, status) {
  const idMap = {binance:'bnbStatus2',bybit:'bybitStatus2',okx:'okxStatus2',mexc:'mexcStatus2',kucoin:'kucoinStatus2'};
  const el = document.getElementById(idMap[exchange]);
  if(!el) return;
  if(status==='saved')    { el.textContent='✅ Configurado'; el.style.color='var(--accent)'; }
  else if(status==='ok')  { el.textContent='✅ Conectado';   el.style.color='var(--accent)'; }
  else if(status==='err') { el.textContent='❌ Error';       el.style.color='var(--red)'; }
  else                    { el.textContent='No configurado'; el.style.color='var(--t3)'; }
}

// ── Test connection ────────────────────────────────────────────────────────
window.testExchangeKeys = async exchange => {
  if(!_masterPass){ toast('Primero guardá tu contraseña maestra.','error'); return; }
  toast(`Probando ${exchange}...`);
  try {
    const keys = await getDecryptedKeys(exchange);
    if(!keys){ toast('No hay keys guardadas para '+exchange,'error'); return; }
    const ok = await pingExchange(exchange, keys);
    updateExchangeStatus(exchange, ok?'ok':'err');
    toast(ok ? `✅ ${exchange} conectado!` : `❌ Error conectando a ${exchange}`, ok?'success':'error');
  } catch(e){ toast('Error: '+e.message,'error'); }
};

async function getDecryptedKeys(exchange) {
  const encrypted = window.G?._getExchangeKey?.(exchange);
  if(!encrypted) return null;
  try { return JSON.parse(await decryptData(encrypted, _masterPass)); }
  catch(e){ toast('Contraseña maestra incorrecta.','error'); return null; }
}

// ── Ping each exchange (test read-only) ───────────────────────────────────
async function pingExchange(exchange, keys) {
  try {
    if(exchange==='binance') {
      const ts  = Date.now();
      const sig = await hmacSHA256(keys.secret, `timestamp=${ts}`);
      const r   = await (window.proxyFetch||fetch)(`https://api.binance.com/api/v3/account?timestamp=${ts}&signature=${sig}`,
        { headers:{'X-MBX-APIKEY': keys.key} });
      return r.ok;
    }
    if(exchange==='bybit') {
      const ts    = Date.now().toString();
      const query = 'accountType=UNIFIED';
      const msg   = ts + keys.key + '5000' + query;
      const sig   = await hmacSHA256(keys.secret, msg);
      const resp  = await (window.proxyFetch||fetch)(
        `https://api.bybit.com/v5/account/wallet-balance?${query}`,
        { headers:{'X-BAPI-API-KEY':keys.key,'X-BAPI-TIMESTAMP':ts,'X-BAPI-SIGN':sig,'X-BAPI-RECV-WINDOW':'5000'} }
      );
      const txt = await resp.text();
      let d; try { d = JSON.parse(txt); } catch(e) { console.error('Bybit test parse error:', txt.slice(0,200)); return false; }
      console.log('Bybit test response:', d);
      return d.retCode === 0;
    }
    if(exchange==='mexc') {
      const ts  = Date.now().toString();
      const q   = '';
      const toSign = keys.key + ts + q;
      const sig = await hmacSHA256(keys.secret, toSign);
      const r   = await (window.proxyFetch||fetch)(
        'https://contract.mexc.com/api/v1/private/account/assets',
        { headers:{'ApiKey':keys.key,'Request-Time':ts,'Signature':sig,'Content-Type':'application/json'} }
      );
      const txt = await r.text();
      let d; try{d=JSON.parse(txt);}catch(e){return false;}
      return d.success===true;
    }
    if(exchange==='kucoin') {
      if(PROXY_URL) {
        const r = await fetch(`${PROXY_URL}/balance?live=1`);
        const d = await r.json();
        return !!d.balances?.KUCOIN && !d.errors?.KUCOIN;
      }
      const ts = Date.now().toString();
      const path = '/api/v1/account-overview?currency=USDT';
      const sig = await hmacSHA256Base64(keys.secret, ts + 'GET' + path);
      const pass = await hmacSHA256Base64(keys.secret, keys.passphrase);
      const r = await (window.proxyFetch||fetch)(
        `https://api-futures.kucoin.com${path}`,
        { headers:{
          'KC-API-KEY':keys.key,
          'KC-API-SIGN':sig,
          'KC-API-TIMESTAMP':ts,
          'KC-API-PASSPHRASE':pass,
          'KC-API-KEY-VERSION':'2',
          'Content-Type':'application/json'
        } }
      );
      const txt = await r.text();
      let d; try{d=JSON.parse(txt);}catch(e){return false;}
      return d.code === '200000';
    }
    if(exchange==='okx') {
      const ts  = new Date().toISOString();
      const msg = ts + 'GET' + '/api/v5/account/balance';
      const sig = btoa(String.fromCharCode(...new Uint8Array(
        await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new TextEncoder().encode(keys.secret),
          {name:'HMAC',hash:'SHA-256'}, false, ['sign']), new TextEncoder().encode(msg))
      )));
      const r = await (window.proxyFetch||fetch)('https://www.okx.com/api/v5/account/balance',
        { headers:{'OK-ACCESS-KEY':keys.key,'OK-ACCESS-SIGN':sig,'OK-ACCESS-TIMESTAMP':ts,'OK-ACCESS-PASSPHRASE':keys.passphrase,} });
      const d = await r.json();
      return d.code === '0';
    }
  } catch(e){ return false; }
}

// ── Fetch open positions from exchange ────────────────────────────────────
async function fetchExchangePositions(exchange, keys) {
  const positions = [];
  try {
    if(exchange==='binance') {
      // Note: Binance private APIs require server-side proxy due to CORS
      // Futures positions
      const ts   = Date.now();
      const qF   = `timestamp=${ts}`;
      const sigF = await hmacSHA256(keys.secret, qF);
      const rF   = await (window.proxyFetch||fetch)(`https://fapi.binance.com/fapi/v2/positionRisk?timestamp=${ts}&signature=${sigF}`,
        { headers:{'X-MBX-APIKEY': keys.key} }).catch(e=>{ throw new Error('CORS: requiere proxy'); });
      const dF   = await rF.json();
      if(Array.isArray(dF)) {
        dF.filter(p=>parseFloat(p.positionAmt)!==0).forEach(p=>{
          const amt    = parseFloat(p.positionAmt);
          const entry  = parseFloat(p.entryPrice);
          const mark   = parseFloat(p.markPrice);
          const pnl    = parseFloat(p.unRealizedProfit);
          const lev    = parseInt(p.leverage)||1;
          const notional = Math.abs(amt)*entry;
          positions.push({
            exchange:'BINANCE', type:'futures',
            ticker: p.symbol.replace('USDT',''),
            symbol: p.symbol,
            dir:    amt>0?'long':'short',
            entry, mark, pnl,
            posSize: notional,
            margin:  notional/lev,
            leverage: lev,
            sl: parseFloat(p.liquidationPrice)||0,
            pnlPct: Math.round(pnl/(notional/lev)*10000)/100,
            exchangeId: `binance-fut-${p.symbol}`,
            raw: p,
          });
        });
      }
      // Note: Spot balances excluded - they are not trading positions
    }

    if(exchange==='bybit') {
      const ts  = Date.now().toString();
      const qF  = 'category=linear&settleCoin=USDT';
      const msg = ts + keys.key + '5000' + qF;
      const sig = await hmacSHA256(keys.secret, msg);
      const r   = await (window.proxyFetch||fetch)(`https://api.bybit.com/v5/position/list?${qF}`,
        { headers:{'X-BAPI-API-KEY':keys.key,'X-BAPI-TIMESTAMP':ts,'X-BAPI-SIGN':sig,'X-BAPI-RECV-WINDOW':'5000'} });
      const rText = await r.text();
      let d;
      try { d = JSON.parse(rText); } catch(e) { throw new Error(`Bybit response not JSON (${r.status}): ${rText.slice(0,100)}`); }
      if(d.retCode===0&&d.result?.list) {
        d.result.list.filter(p=>parseFloat(p.size)>0).forEach(p=>{
          const entry   = parseFloat(p.avgPrice);
          const mark    = parseFloat(p.markPrice);
          const pnl     = parseFloat(p.unrealisedPnl);
          const lev     = parseInt(p.leverage)||1;
          const notional= parseFloat(p.positionValue)||0;
          positions.push({
            exchange:'BYBIT', type:'futures',
            ticker: p.symbol.replace('USDT',''),
            symbol: p.symbol,
            dir:    p.side==='Buy'?'long':'short',
            entry, mark, pnl,
            posSize: notional,
            margin:  parseFloat(p.positionIM)||notional/lev,
            leverage: lev,
            sl: parseFloat(p.stopLoss)||0,
            tp1: parseFloat(p.takeProfit)||0,
            pnlPct: Math.round(pnl/(parseFloat(p.positionIM)||1)*10000)/100,
            exchangeId: `bybit-fut-${p.symbol}-${p.side}`,
            raw: p,
          });
        });
      }
    }

    if(exchange==='mexc') {
      const ts  = Date.now().toString();
      const q   = '';
      const toSign = keys.key + ts + q;
      const sig = await hmacSHA256(keys.secret, toSign);
      const r   = await (window.proxyFetch||fetch)(
        'https://contract.mexc.com/api/v1/private/account/assets',
        { headers:{'ApiKey':keys.key,'Request-Time':ts,'Signature':sig,'Content-Type':'application/json'} }
      );
      const txt = await r.text();
      let d; try{d=JSON.parse(txt);}catch(e){return false;}
      return d.success===true;
    }
    if(exchange==='okx') {
      const ts  = new Date().toISOString();
      const sig = async (path) => {
        const msg = ts+'GET'+path;
        return btoa(String.fromCharCode(...new Uint8Array(
          await crypto.subtle.sign('HMAC',
            await crypto.subtle.importKey('raw',new TextEncoder().encode(keys.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),
            new TextEncoder().encode(msg)))));
      };
      const hdr = async (path) => ({
        'OK-ACCESS-KEY': keys.key,
        'OK-ACCESS-SIGN': await sig(path),
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': keys.passphrase,
      });

      // Futures positions
      const pPath = '/api/v5/account/positions?instType=SWAP';
      const rF = await (window.proxyFetch||fetch)('https://www.okx.com'+pPath, {headers: await hdr(pPath)});
      const dF = await rF.json();
      if(dF.code==='0'&&dF.data) {
        dF.data.filter(p=>parseFloat(p.pos)!==0).forEach(p=>{
          const entry   = parseFloat(p.avgPx);
          const mark    = parseFloat(p.markPx);
          const pnl     = parseFloat(p.upl);
          const lev     = parseInt(p.lever)||1;
          const notional= parseFloat(p.notionalUsd)||0;
          positions.push({
            exchange:'OKX', type:'futures',
            ticker: p.instId.replace('-USDT-SWAP','').replace('-',''),
            symbol: p.instId,
            dir:    p.posSide==='long'?'long':'short',
            entry, mark, pnl,
            posSize: notional,
            margin:  parseFloat(p.imr)||notional/lev,
            leverage: lev,
            sl: parseFloat(p.sl)||0,
            tp1: parseFloat(p.tp)||0,
            pnlPct: Math.round(pnl/(parseFloat(p.imr)||1)*10000)/100,
            exchangeId: `okx-fut-${p.instId}-${p.posSide}`,
            raw: p,
          });
        });
      }
    }
  } catch(e){
    if(e.message?.includes('CORS') || e.message?.includes('fetch')) {
      console.warn(`${exchange} API blocked by CORS - this exchange requires a proxy for private endpoints`);
    } else {
      console.error(`fetchExchangePositions ${exchange}:`, e);
    }
  }
  return positions;
}

// ── Live exchange positions state ─────────────────────────────────────────
let exchangePositions = []; // positions from all exchanges
window.exchangePositions = exchangePositions;
let lastSyncTime = null;

// ── Fetch closed trade history from exchanges (from Jan 1 2026) ─────────────
const HISTORY_START = Math.floor(new Date('2026-01-01T00:00:00Z').getTime());

async function fetchExchangeHistory(exchange, keys) {
  const closedTrades = [];
  try {
    if(exchange==='binance') {
      // Futures trade history
      const ts  = Date.now();
      const q   = `startTime=${HISTORY_START}&limit=1000&timestamp=${ts}`;
      const sig = await hmacSHA256(keys.secret, q);
      const r   = await (window.proxyFetch||fetch)(`https://fapi.binance.com/fapi/v1/userTrades?${q}&signature=${sig}`,
        { headers:{'X-MBX-APIKEY':keys.key} });
      const d   = await r.json();
      if(Array.isArray(d)) {
        // Group by orderId to reconstruct trades
        const byOrder = {};
        d.forEach(t=>{
          if(!byOrder[t.orderId]) byOrder[t.orderId]={trades:[],symbol:t.symbol,side:t.side,realizedPnl:0,commission:0,qty:0,price:0,time:t.time};
          byOrder[t.orderId].trades.push(t);
          byOrder[t.orderId].realizedPnl += parseFloat(t.realizedPnl);
          byOrder[t.orderId].commission  += parseFloat(t.commission);
          byOrder[t.orderId].qty         += parseFloat(t.qty);
          byOrder[t.orderId].price        = parseFloat(t.price); // last fill price
        });
        Object.values(byOrder).filter(o=>o.realizedPnl!==0).forEach(o=>{
          const ticker = o.symbol.replace('USDT','');
          const dir    = o.side==='BUY'?'long':'short';
          const pnl    = Math.round(o.realizedPnl*100)/100;
          const fees   = Math.round(o.commission*100)/100;
          closedTrades.push({
            exchangeSource:'BINANCE',
            exchangeId:`bnb-hist-${o.trades[0].orderId}`,
            ticker, dir, exchange:'BINANCE',
            entry:  parseFloat(o.trades[0]?.price)||0,
            closePrice: o.price,
            pnl: pnl - fees,
            pnlRaw: pnl,
            fees,
            posSize: o.qty * o.price,
            leverage: 1, // we don't have this from trade history
            createdAt: new Date(o.time).toISOString(),
            closeDate: new Date(o.time).toISOString().split('T')[0],
            status:'closed', type:'futures',
          });
        });
      }
    }

    if(exchange==='bybit') {
      const ts  = Date.now().toString();
      const q   = `category=linear&startTime=${HISTORY_START}&limit=100`;
      const msg = ts+keys.key+'5000'+q;
      const sig = await hmacSHA256(keys.secret, msg);
      const r   = await (window.proxyFetch||fetch)(`https://api.bybit.com/v5/execution/list?${q}`,
        { headers:{'X-BAPI-API-KEY':keys.key,'X-BAPI-TIMESTAMP':ts,'X-BAPI-SIGN':sig,'X-BAPI-RECV-WINDOW':'5000'} });
      const d   = await r.json();
      if(d.retCode===0&&d.result?.list) {
        // Group by orderId
        const byOrder = {};
        d.result.list.forEach(t=>{
          if(!byOrder[t.orderId]) byOrder[t.orderId]={trades:[],symbol:t.symbol,side:t.side,pnl:0,fee:0,time:parseInt(t.execTime)};
          byOrder[t.orderId].trades.push(t);
          byOrder[t.orderId].pnl += parseFloat(t.closedPnl||0);
          byOrder[t.orderId].fee += parseFloat(t.execFee||0);
        });
        Object.values(byOrder).filter(o=>o.pnl!==0).forEach(o=>{
          const ticker = o.symbol.replace('USDT','');
          const dir    = o.side==='Buy'?'long':'short';
          const pnl    = Math.round(o.pnl*100)/100;
          const fees   = Math.round(o.fee*100)/100;
          closedTrades.push({
            exchangeSource:'BYBIT',
            exchangeId:`bybit-hist-${o.trades[0].orderId}`,
            ticker, dir, exchange:'BYBIT',
            entry:  parseFloat(o.trades[0]?.execPrice)||0,
            closePrice: parseFloat(o.trades[o.trades.length-1]?.execPrice)||0,
            pnl: pnl - fees,
            pnlRaw: pnl, fees,
            posSize: parseFloat(o.trades[0]?.execValue)||0,
            leverage: 1,
            createdAt: new Date(o.time).toISOString(),
            closeDate: new Date(o.time).toISOString().split('T')[0],
            status:'closed', type:'futures',
          });
        });
      }
    }

    if(exchange==='mexc') {
      const ts  = Date.now().toString();
      const q   = '';
      const toSign = keys.key + ts + q;
      const sig = await hmacSHA256(keys.secret, toSign);
      const r   = await (window.proxyFetch||fetch)(
        'https://contract.mexc.com/api/v1/private/account/assets',
        { headers:{'ApiKey':keys.key,'Request-Time':ts,'Signature':sig,'Content-Type':'application/json'} }
      );
      const txt = await r.text();
      let d; try{d=JSON.parse(txt);}catch(e){return false;}
      return d.success===true;
    }
    if(exchange==='okx') {
      const ts  = new Date().toISOString();
      const makeSig = async (path) => {
        const msg = ts+'GET'+path;
        return btoa(String.fromCharCode(...new Uint8Array(
          await crypto.subtle.sign('HMAC',
            await crypto.subtle.importKey('raw',new TextEncoder().encode(keys.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),
            new TextEncoder().encode(msg)))));
      };
      const hdr = async (path) => ({
        'OK-ACCESS-KEY':keys.key, 'OK-ACCESS-SIGN':await makeSig(path),
        'OK-ACCESS-TIMESTAMP':ts, 'OK-ACCESS-PASSPHRASE':keys.passphrase,
      });
      const begin = HISTORY_START.toString();
      const path  = `/api/v5/trade/fills-history?instType=SWAP&begin=${begin}&limit=100`;
      const r     = await (window.proxyFetch||fetch)('https://www.okx.com'+path, {headers: await hdr(path)});
      const d     = await r.json();
      if(d.code==='0'&&d.data) {
        const byOrder = {};
        d.data.forEach(t=>{
          if(!byOrder[t.ordId]) byOrder[t.ordId]={trades:[],instId:t.instId,side:t.side,pnl:0,fee:0,time:parseInt(t.ts)};
          byOrder[t.ordId].trades.push(t);
          byOrder[t.ordId].pnl += parseFloat(t.pnl||0);
          byOrder[t.ordId].fee += parseFloat(t.fee||0);
        });
        Object.values(byOrder).filter(o=>o.pnl!==0).forEach(o=>{
          const ticker = o.instId.replace('-USDT-SWAP','').replace('-','');
          const dir    = o.side==='buy'?'long':'short';
          const pnl    = Math.round(o.pnl*100)/100;
          const fees   = Math.round(Math.abs(o.fee)*100)/100;
          closedTrades.push({
            exchangeSource:'OKX',
            exchangeId:`okx-hist-${o.trades[0].tradeId}`,
            ticker, dir, exchange:'OKX',
            entry:  parseFloat(o.trades[0]?.fillPx)||0,
            closePrice: parseFloat(o.trades[o.trades.length-1]?.fillPx)||0,
            pnl: pnl - fees,
            pnlRaw: pnl, fees,
            posSize: parseFloat(o.trades[0]?.fillNotionalUsd)||0,
            leverage: 1,
            createdAt: new Date(o.time).toISOString(),
            closeDate: new Date(o.time).toISOString().split('T')[0],
            status:'closed', type:'futures',
          });
        });
      }
    }
  } catch(e){ console.error(`fetchExchangeHistory ${exchange}:`,e); }
  return closedTrades;
}

// Save exchange history trades to Firestore (skip already imported)
async function importExchangeHistory(exchange, keys) {
  const history = await fetchExchangeHistory(exchange, keys);
  if(!history.length) return 0;
  // Get existing exchangeIds to avoid duplicates
  const G = window.G;
  const existing = new Set((G?.trades()||[]).map(t=>t.exchangeId).filter(Boolean));
  let count = 0;
  for(const t of history) {
    if(existing.has(t.exchangeId)) continue;
    try {
      await window._fb.addDoc(window._fb.collection(window._fb.db,'trades'), { userId:window._getCU()?.uid, ...t });
      count++;
    } catch(e){}
  }
  return count;
}

window.syncAllExchanges = async () => {
  const syncBtn = document.getElementById('syncBtn');
  if(syncBtn){ syncBtn.textContent='⟳ Sincronizando...'; syncBtn.disabled=true; }

  // Use Worker backend if proxy URL is configured
  if(PROXY_URL) {
    try {
      const r    = await fetch(`${PROXY_URL}/balance?t=${Date.now()}`, { cache:'no-store' });
      const data = await r.json();

      exchangePositions        = [];
      window.exchangePositions = exchangePositions;
      window.exchangeOrders    = [];
      exchangeOrders           = [];
      lastSyncTime             = new Date();

      // Cache liquidity data for dashboard
      if (data.balances) {
        const displayData = applyManualCapitalOverlay(data);
        _liquidityCache = displayData;
        window._liquidityCache = displayData;
        if (window._drawCapitalPie) setTimeout(window._drawCapitalPie, 200);
      }
      if (data.liquidity) window._updateLiquidityCache(applyManualCapitalOverlay(data));

      try { renderPositions(); } catch(e) { console.error('renderPositions error:', e); }
      try { renderOrders(); } catch(e) { console.error('renderOrders error:', e); }
      try { renderMap(); } catch(e) { console.error('renderMap error:', e); }
      try { updateStatusBar(); } catch(e) { console.error('updateStatusBar error:', e); }

      const errs = Object.entries(data.errors||{}).filter(([,v])=>v);
      const errTxt = errs.length ? ' · revisar ' + errs.map(([ex])=>ex.toUpperCase()).join('/') : '';
      const totalCapital = Number(data.liquidity?.total ?? data.totals?.total ?? 0) || 0;
      const msg   = `✅ Capital $${fmt(totalCapital)}${errTxt}`;
      const syncBtnEl = document.getElementById('syncBtn');
      if(syncBtnEl){ syncBtnEl.textContent = msg; syncBtnEl.disabled = false; }

      // Show errors if any
      if(errs.length) {
        errs.forEach(([ex, err]) => console.warn(`${ex}: ${err}`));
        toast('Sincronización parcial: ' + errs.map(([ex, err]) => `${ex.toUpperCase()} (${String(err).slice(0, 80)})`).join(' | '), 'error');
      }
      return;
    } catch(e) {
      console.error('Worker sync failed:', e.message);
      toast('Error al sincronizar: ' + e.message, 'error');
      const syncBtnEl = document.getElementById('syncBtn');
      if(syncBtnEl){ syncBtnEl.textContent='↻ Sync capital'; syncBtnEl.disabled=false; }
      return;
    }
  }

  // Fallback: direct exchange calls (requires master password)
  if(!_masterPass) { toast('Ingresá tu contraseña maestra primero','error'); return; }
  const exchanges = ['binance','bybit','okx','mexc','kucoin'];
  const all = [];
  const statusLines = [];
  for(const ex of exchanges) {
    const keys = await getDecryptedKeys(ex);
    if(!keys){ statusLines.push(`${ex.toUpperCase()}: no configurado`); continue; }
    try {
      const pos = await fetchExchangePositions(ex, keys);
      all.push(...pos);
      updateExchangeStatus(ex, 'ok');
      statusLines.push(`✅ ${ex.toUpperCase()}: ${pos.filter(p=>p.type==='futures').length} futuros, ${pos.filter(p=>p.type==='spot').length} spot`);
    } catch(e){
      updateExchangeStatus(ex, 'err');
      statusLines.push(`❌ ${ex.toUpperCase()}: ${e.message}`);
    }
  }
  // Auto-close detection DISABLED — history comes from exchange import only
  // (avoids fake entries when sync fluctuates)
  const closedNow = [];

  exchangePositions = all;
  window.exchangePositions = all; // expose for renderPositions
  lastSyncTime = new Date();

  // Show sync card in settings if open
  const sc = document.getElementById('syncCard');
  if(sc&&sc.style.display!=='none'){
    document.getElementById('syncStatus').innerHTML = statusLines.join('<br>') +
      (closedNow.length?`<br>📋 ${closedNow.length} posición/es cerrada/s y guardada/s en historial`:'');
  }
  // Update positions page if visible
  const posPage = document.getElementById('posPage');
  if(posPage&&posPage.style.display!=='none') renderPositions();
  const openCount = all.filter(p=>p.type==='futures').length;
  const msg = `✅ ${openCount} posición${openCount!==1?'es':''} sincronizada${openCount!==1?'s':''}${closedNow.length?' · '+closedNow.length+' cerradas':''}`;
  if(all.length || closedNow.length) toast(msg);
  // Update sync button
  const syncBtnEl = document.getElementById('syncBtn');
  if(syncBtnEl){ syncBtnEl.textContent = msg; syncBtnEl.disabled=false; }
  // Always re-render positions after sync
  renderPositions();
  renderMap();
  updateStatusBar();
  return all;
};

window.importAllHistory = async () => {
  if(!_masterPass){ toast('Ingresá tu contraseña maestra primero.','error'); return; }
  const btn = document.getElementById('importHistBtn');
  if(btn){ btn.disabled=true; btn.textContent='⟳ Importando...'; }
  const exchanges = ['binance','bybit','okx','mexc','kucoin'];
  let totalImported = 0;
  const lines = [];
  for(const ex of exchanges){
    const keys = await getDecryptedKeys(ex);
    if(!keys){ lines.push(`${ex.toUpperCase()}: no configurado`); continue; }
    try {
      const n = await importExchangeHistory(ex, keys);
      totalImported += n;
      lines.push(`✅ ${ex.toUpperCase()}: ${n} trades importados`);
    } catch(e){
      lines.push(`❌ ${ex.toUpperCase()}: ${e.message}`);
    }
  }
  if(totalImported>0){
    await window._loadTrades();
    renderHistory();
    renderDashboard();
  }
  const sc = document.getElementById('syncCard');
  if(sc){ sc.style.display='block'; document.getElementById('syncStatus').innerHTML=lines.join('<br>'); }
  toast(`Historial importado: ${totalImported} trades`);
  if(btn){ btn.disabled=false; btn.textContent='📥 Importar historial 2026'; }
};

// Auto-sync every 30s when on positions page
let syncTimer = null;
function startAutoSync() {
  if(syncTimer) clearInterval(syncTimer);
  // Sync exchange capital every 30s; positions and orders stay manual.
  setTimeout(() => window.syncAllExchanges?.(), 1200);
  syncTimer = setInterval(() => window.syncAllExchanges?.(), 30000);
}

// ── AI Analysis autocomplete ───────────────────────────────────────────────
let _bnbSymbols = []; // all Binance USDT pairs

const STOCK_LIST = [
  {s:'AAPL',n:'Apple',t:'stock'},{s:'MSFT',n:'Microsoft',t:'stock'},{s:'GOOGL',n:'Alphabet',t:'stock'},
  {s:'AMZN',n:'Amazon',t:'stock'},{s:'NVDA',n:'NVIDIA',t:'stock'},{s:'TSLA',n:'Tesla',t:'stock'},
  {s:'META',n:'Meta',t:'stock'},{s:'NFLX',n:'Netflix',t:'stock'},{s:'AMD',n:'AMD',t:'stock'},
  {s:'INTC',n:'Intel',t:'stock'},{s:'BA',n:'Boeing',t:'stock'},{s:'JPM',n:'JPMorgan',t:'stock'},
  {s:'GS',n:'Goldman Sachs',t:'stock'},{s:'V',n:'Visa',t:'stock'},{s:'WMT',n:'Walmart',t:'stock'},
  {s:'SPY',n:'S&P 500 ETF',t:'etf'},{s:'VOO',n:'Vanguard S&P 500 ETF',t:'etf'},
  {s:'IVV',n:'iShares Core S&P 500 ETF',t:'etf'},{s:'QQQ',n:'Nasdaq ETF',t:'etf'},
  {s:'DIA',n:'Dow Jones ETF',t:'etf'},{s:'IWM',n:'Russell 2000',t:'etf'},
  {s:'VTI',n:'Total US Market ETF',t:'etf'},{s:'VEA',n:'Developed Markets ETF',t:'etf'},
  {s:'VWO',n:'Emerging Markets ETF',t:'etf'},{s:'XLK',n:'Technology Sector ETF',t:'etf'},
  {s:'XLE',n:'Energy Sector ETF',t:'etf'},{s:'XLF',n:'Financial Sector ETF',t:'etf'},
  {s:'ARKK',n:'ARK Innovation ETF',t:'etf'},{s:'HYG',n:'High Yield Bond ETF',t:'etf'},
  {s:'LQD',n:'Investment Grade Bond ETF',t:'etf'},{s:'SHY',n:'1-3Y Treasury ETF',t:'etf'},
  {s:'IEF',n:'7-10Y Treasury ETF',t:'etf'},{s:'BIL',n:'1-3M Treasury ETF',t:'etf'},
  {s:'GLD',n:'Gold ETF',t:'etf'},{s:'IAU',n:'iShares Gold Trust',t:'etf'},
  {s:'IAUM',n:'iShares Gold Trust Micro ETF',t:'etf'},{s:'SGOL',n:'Physical Gold ETF',t:'etf'},
  {s:'PHYS',n:'Sprott Physical Gold Trust',t:'etf'},
  {s:'SLV',n:'Silver ETF',t:'etf'},{s:'SIVR',n:'Physical Silver ETF',t:'etf'},
  {s:'PSLV',n:'Sprott Physical Silver Trust',t:'etf'},
  {s:'USO',n:'United States Oil Fund',t:'etf'},{s:'UNG',n:'United States Natural Gas Fund',t:'etf'},
  {s:'CPER',n:'United States Copper Fund',t:'etf'},{s:'PPLT',n:'Physical Platinum ETF',t:'etf'},
  {s:'TLT',n:'Bonds 20Y ETF',t:'etf'},
  {s:'VIX',n:'Volatility Index',t:'index'},{s:'DXY',n:'Dollar Index',t:'index'},
  {s:'GC=F',n:'Oro (Futures)',t:'commodity'},{s:'SI=F',n:'Plata (Futures)',t:'commodity'},
  {s:'CL=F',n:'Petróleo WTI',t:'commodity'},{s:'BZ=F',n:'Petróleo Brent',t:'commodity'},
  {s:'NG=F',n:'Gas Natural',t:'commodity'},{s:'HG=F',n:'Cobre',t:'commodity'},
];

// MEXC perpetual commodities — verified symbols from contract.mexc.com/api/v1/contract/detail
const MEXC_COMMODITIES = [
  {s:'XAUT_USDT',  n:'Oro / Gold (PAXG)',    t:'commodity', src:'mexc', sym:'XAUT_USDT'},
  {s:'XAG_USDT',   n:'Plata / Silver',       t:'commodity', src:'mexc', sym:'XAG_USDT'},
  {s:'USOIL_USDT', n:'Petróleo WTI / Oil',   t:'commodity', src:'mexc', sym:'USOIL_USDT'},
  {s:'UKOIL_USDT', n:'Petróleo Brent',       t:'commodity', src:'mexc', sym:'UKOIL_USDT'},
];

async function loadBinanceSymbols() {
  if(_bnbSymbols.length) return;
  try {
    const r = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const d = await r.json();
    _bnbSymbols = d.symbols
      .filter(s=>s.quoteAsset==='USDT'&&s.status==='TRADING')
      .map(s=>({ s:s.symbol, n:s.baseAsset, t:'crypto' }));
  } catch(e){ console.warn('Could not load Binance symbols'); }
}

window.showTickerSuggestions = async (val) => {
  const dd = document.getElementById('aiTickerDD');
  if(!dd) return;
  const q = val.toUpperCase().trim();
  if(q.length < 2){ dd.style.display='none'; return; }

  await loadBinanceSymbols();

  // Match crypto
  const cryptoMatches = _bnbSymbols
    .filter(s=>s.s.startsWith(q)||s.n.startsWith(q))
    .slice(0,6)
    .map(s=>({label:`${s.s} — ${s.n}`, ticker:s.s, source:'binance', type:'crypto'}));

  // Match stocks/etfs/commodities
  const stockMatches = STOCK_LIST
    .filter(s=>s.s.startsWith(q)||s.n.toUpperCase().includes(q))
    .slice(0,4)
    .map(s=>({label:`${s.s} — ${s.n}`, ticker:s.s, source:'yahoo', type:s.t}));

  // Match MEXC commodities — search by symbol, name or short keyword
  const MEXC_KEYWORDS = {
    OIL:'USOIL_USDT',WTI:'USOIL_USDT',PETROLEO:'USOIL_USDT',PETROLEO_WTI:'USOIL_USDT',
    BRENT:'UKOIL_USDT',UKOIL:'UKOIL_USDT',
    GOLD:'XAUT_USDT',ORO:'XAUT_USDT',XAUT:'XAUT_USDT',
    SILVER:'XAG_USDT',PLATA:'XAG_USDT',XAG:'XAG_USDT',
  };
  const kwMatch = MEXC_KEYWORDS[q];
  const mexcMatches = MEXC_COMMODITIES
    .filter(s=>s.s.toUpperCase().includes(q)||s.n.toUpperCase().includes(q)||
               s.sym.toUpperCase().includes(q)||(kwMatch&&s.sym===kwMatch))
    .slice(0,5)
    .map(s=>({label:`${s.sym} — ${s.n}`, ticker:s.sym, source:'mexc', type:s.t}));

  const exactKnown = [...cryptoMatches, ...stockMatches, ...mexcMatches].some(x => x.ticker === q);
  const genericYahoo = /^[A-Z0-9.\-=]{2,12}$/.test(q) && !exactKnown
    ? [{label:`${q} - Buscar en Yahoo Finance`, ticker:q, source:'yahoo', type:'etf'}]
    : [];
  if (genericYahoo[0]) genericYahoo[0].label = `${q} - Buscar en Yahoo Finance`;
  const all = [...cryptoMatches, ...stockMatches, ...genericYahoo, ...mexcMatches];
  if(!all.length){ dd.style.display='none'; return; }

  const typeIcon = {crypto:'₿',stock:'📈',etf:'📊',commodity:'🪙',index:'📉'};
  const typeColor = {crypto:'var(--accent)',stock:'var(--blue)',etf:'var(--amber)',commodity:'var(--amber)',index:'var(--t2)'};
  const srcLabel = {binance:'SPOT/FUT',yahoo:'Yahoo',mexc:'MEXC PERP'};

  dd.innerHTML = all.map((r,i)=>`
    <div onclick="selectTicker('${r.ticker}','${r.source}','${r.type}')"
      style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:0.5px solid var(--border);"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <span style="font-size:12px;">${typeIcon[r.type]||'•'}</span>
      <div>
        <div style="font-family:var(--mono);font-size:11px;font-weight:600;">${r.ticker}</div>
        <div style="font-size:10px;color:var(--t3);">${r.label.split('—')[1]?.trim()||''} · <span style="color:${typeColor[r.type]}">${r.type.toUpperCase()}</span></div>
      </div>
      ${srcLabel[r.source]?`<span style="margin-left:auto;font-size:9px;color:var(--t3);">${srcLabel[r.source]}</span>`:''}
    </div>`).join('');
  dd.style.display='block';
};

window.selectTicker = (ticker, source, type) => {
  document.getElementById('aiSymbol').value = ticker;
  document.getElementById('aiTickerDD').style.display='none';
  if(type==='crypto') {
    setMarketType('futures');
  } else if(source==='mexc') {
    setMarketType('futures'); // MEXC commodities are perpetual futures
  } else {
    setMarketType('spot');
  }
  window._aiSource = source;
  window._aiType   = type;
  loadCharts();
};

// Override fetchOHLCV to support Yahoo Finance for stocks
const _origFetchOHLCV = fetchOHLCV;
window.fetchOHLCV = async (symbol, interval, limit=300) => {
  if(window._aiSource==='yahoo') {
    // Map LW intervals to Yahoo intervals
    const ivMap = {'1M':'1mo','1w':'1wk','1d':'1d','4h':'1h','1h':'1h'};
    const yhIv  = ivMap[interval]||'1d';
    const range = interval==='1M'?'10y':interval==='1w'?'5y':interval==='1d'?'1y':interval==='4h'?'3mo':'1mo';
    try {
      const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yhIv}&range=${range}`;
      const r = await (window.proxyFetch ? window.proxyFetch(yhUrl) : fetch(yhUrl));
      const d = await r.json();
      const res = d.chart?.result?.[0];
      if(!res) throw new Error('Sin datos Yahoo');
      const ts = res.timestamp;
      const q  = res.indicators.quote[0];
      return ts.map((t,i)=>({
        time:t, open:q.open[i]||0, high:q.high[i]||0,
        low:q.low[i]||0, close:q.close[i]||0, volume:q.volume[i]||0
      })).filter(c=>c.open>0);
    } catch(e){ return _origFetchOHLCV(symbol, interval, limit); }
  }
  return _origFetchOHLCV(symbol, interval, limit);
};

// ── Master password unlock flow ────────────────────────────────────────────
window.checkMasterPassNeeded = async function() {
  const G = window.G;
  if(!G?._hasExchangeKeys?.()) return;
  if(_masterPass) { // already unlocked (from sessionStorage or this session)
    syncAllExchanges();
    startAutoSync();
    return;
  }

  // Show which exchanges are configured
  const configured = ['binance','bybit','okx','mexc','kucoin'].filter(ex=>G._hasExchangeKey?.(ex));
  if(!configured.length) return;

  const badges = configured.map(ex=>`
    <span style="background:var(--bg3);border:0.5px solid var(--border2);padding:3px 10px;border-radius:4px;font-family:var(--mono);font-size:10px;font-weight:600;">
      ${ex==='binance'?'⬡ Binance':ex==='bybit'?'◈ Bybit':'OK OKX'}
    </span>`).join('');
  document.getElementById('masterPassExchanges').innerHTML = badges;
  const remember = document.getElementById('rememberDexPass');
  if (remember) remember.checked = !!localStorage.getItem(MASTER_PASS_DEVICE_KEY);
  openModal('masterPassModal');
  setTimeout(()=>document.getElementById('unlockPass')?.focus(), 300);
};

window.doUnlock = async () => {
  const pass = document.getElementById('unlockPass').value;
  const remember = document.getElementById('rememberDexPass')?.checked || false;
  if(!pass){ document.getElementById('unlockError').textContent='Ingresá tu contraseña.'; document.getElementById('unlockError').style.display='block'; return; }
  // Test decryption with a known exchange
  const G = window.G;
  _masterPass = pass;
  sessionStorage.setItem(MASTER_PASS_SESSION_KEY, pass);
  if (remember) localStorage.setItem(MASTER_PASS_DEVICE_KEY, pass);
  else localStorage.removeItem(MASTER_PASS_DEVICE_KEY);
  try {
    const configured = ['binance','bybit','okx','mexc','kucoin'].filter(ex=>G?._hasExchangeKey?.(ex));
    if(configured.length){
      const keys = await getDecryptedKeys(configured[0]);
      if(!keys) throw new Error('Contraseña incorrecta');
    }
    document.getElementById('unlockPass').value='';
    document.getElementById('unlockError').style.display='none';
    closeModal('masterPassModal');
    toast('Exchanges conectados ✓');
    syncAllExchanges();
    startAutoSync();
  } catch(e){
    _masterPass='';
    sessionStorage.removeItem(MASTER_PASS_SESSION_KEY);
    localStorage.removeItem(MASTER_PASS_DEVICE_KEY);
    document.getElementById('unlockError').textContent='Contraseña incorrecta. Intentá de nuevo.';
    document.getElementById('unlockError').style.display='block';
  }
};

// ── Quick trader assignment from position card ────────────────────────────
window.quickAssignTrader = (exchangeId) => {
  const G = window.G;
  const traders = G?.traders()||[];
  if(!traders.length){ toast('Primero agregá traders en la página Traders.','error'); return; }

  // Build inline dropdown
  const pos = exchangePositions.find(p=>p.exchangeId===exchangeId);
  if(!pos) return;

  const opts = traders.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  const id = 'aq-'+exchangeId.replace(/[^a-z0-9]/gi,'');

  // Find the button and replace with select+confirm
  const btn = document.querySelector(`[onclick="quickAssignTrader('${exchangeId}')"]`);
  if(!btn) return;
  const parent = btn.parentElement;
  btn.outerHTML = `
    <div style="display:flex;gap:4px;align-items:center;">
      <select id="${id}" style="padding:2px 6px;font-size:10px;height:22px;min-width:100px;">
        <option value="">Trader...</option>${opts}
      </select>
      <button onclick="confirmAssignTrader('${exchangeId}','${id}')" style="padding:2px 6px;background:var(--accent);border:none;border-radius:4px;font-size:9px;font-weight:700;color:#000;cursor:pointer;">OK</button>
    </div>`;
};

window.confirmAssignTrader = async (exchangeId, selectId) => {
  const G = window.G;
  const traderId = document.getElementById(selectId)?.value;
  if(!traderId){ toast('Seleccioná un trader.','error'); return; }
  const traderName = G?.traders().find(t=>t.id===traderId)?.name||'';

  // Store trader assignment for this exchangeId in Firestore
  try {
    if(G?._saveTraderAssignment) await G._saveTraderAssignment(exchangeId, traderId, traderName);
    // Update local state
    const pos = exchangePositions.find(p=>p.exchangeId===exchangeId);
    if(pos){ pos.traderId=traderId; pos.traderName=traderName; }
    renderPositions();
    toast(`Trader asignado: ${traderName}`);
  } catch(e){ toast('Error: '+e.message,'error'); }
};

// ── Trading preferences (save/load) ─────────────────────────────────────
let userPrefs = { capital:0, risk:200, lev:10, exchange:'binance', notif:false };

window.savePrefs = () => {
  userPrefs.capital  = parseFloat(document.getElementById('prefCapital')?.value)||0;
  userPrefs.risk     = parseFloat(document.getElementById('prefRisk')?.value)||200;
  userPrefs.lev      = parseInt(document.getElementById('prefLev')?.value)||10;
  userPrefs.exchange = document.getElementById('prefExchange')?.value||'binance';
  userPrefs.notif    = document.getElementById('prefNotif')?.checked||false;
  localStorage.setItem('mauex_prefs', JSON.stringify(userPrefs));
  // Apply immediately to calculator
  const riskEl = document.getElementById('cRisk');
  if(riskEl && !riskEl.dataset.userModified) riskEl.value = userPrefs.risk;
  if(window.saveTheme) window.saveTheme(curTheme); // also persist theme
};

function loadUserPrefs() {
  try {
    const stored = localStorage.getItem('mauex_prefs');
    if(stored) userPrefs = {...userPrefs, ...JSON.parse(stored)};
  } catch(e){}
  // Apply to settings fields
  const f = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
  f('prefCapital', userPrefs.capital||'');
  f('prefRisk',    userPrefs.risk||200);
  f('prefLev',     userPrefs.lev||10);
  f('prefNotif',   '');
  const pfEx = document.getElementById('prefExchange');
  if(pfEx) pfEx.value = userPrefs.exchange||'binance';
  const pfNotif = document.getElementById('prefNotif');
  if(pfNotif) pfNotif.checked = userPrefs.notif||false;
  // Apply risk default to calculator
  const cRisk = document.getElementById('cRisk');
  if(cRisk) cRisk.value = userPrefs.risk||200;
  // Apply default exchange
  if(userPrefs.exchange) setEx(userPrefs.exchange);
}

// ── Export all data as CSV ───────────────────────────────────────────────
window.exportAllData = () => {
  const G = window.G; if(!G) return;
  const all = G.trades();
  const headers = ['ticker','dir','exchange','trader','entry','closePrice','pnl','pnlPct','daysOpen','status','createdAt','closeDate','notes','closeNotes'];
  const rows = all.map(t=>headers.map(h=>{
    const v = t[h]||'';
    return typeof v==='string'&&v.includes(',') ? `"${v}"` : v;
  }).join(','));
  const csv = [headers.join(','),...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mauex_historial_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  toast('CSV descargado.');
};

// ── Delete exchange-imported trades only ─────────────────────────────────
window.exportHistoryForChatGPT = (context='history') => {
  const rows = getFilteredHistoryRows(context);
  if(!rows.length) { toast('No hay trades para exportar.','error'); return; }

  const esc = v => {
    const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
    return /[",]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const dateOnly = v => {
    if(!v) return '';
    const s = String(v);
    return s.includes('T') ? s.split('T')[0] : s;
  };
  const headers = [
    'ticker','direction','exchange','trader','entry_price','exit_price',
    'pnl_usd','pnl_pct','open_date','close_date','days_open','result','notes'
  ];
  const csvRows = rows.map(t => [
    t.ticker || '',
    t.dir || '',
    t.exchange || '',
    t.traderName || '',
    t.entry ?? '',
    t.closePrice || t.exitPrice || t.exit || '',
    t.pnl ?? '',
    t.pnlPct ?? '',
    dateOnly(t.createdAt),
    dateOnly(historyCloseDateOf(t)),
    t.daysOpen ?? '',
    (t.pnl || 0) >= 0 ? 'win' : 'loss',
    historyNotesOf(t),
  ].map(esc).join(','));

  const wins = rows.filter(t => (t.pnl||0) > 0).length;
  const losses = rows.filter(t => (t.pnl||0) < 0).length;
  const totPnl = rows.reduce((s,t)=>s+(t.pnl||0),0);
  const avgWin = wins ? rows.filter(t=>(t.pnl||0)>0).reduce((s,t)=>s+(t.pnl||0),0)/wins : 0;
  const avgLoss = losses ? rows.filter(t=>(t.pnl||0)<0).reduce((s,t)=>s+(t.pnl||0),0)/losses : 0;
  const exportText = [
    'Analiza este historial de trades de MAUex.',
    '',
    'Quiero conclusiones practicas sobre performance, patrones, errores repetidos, mejores y peores traders/tickers, win rate, expectancy, drawdowns y recomendaciones concretas para mejorar.',
    '',
    `Resumen: ${rows.length} trades | WR: ${Math.round(wins/rows.length*100)}% | PnL total: ${totPnl.toFixed(2)} | Avg win: ${avgWin.toFixed(2)} | Avg loss: ${avgLoss.toFixed(2)}`,
    '',
    headers.join(','),
    ...csvRows,
  ].join('\n');

  const blob = new Blob([exportText], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mauex_historial_chatgpt_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  toast('Historial exportado para ChatGPT.');
};

const loadJsPdf = () => new Promise((resolve, reject) => {
  if (window.jspdf?.jsPDF) return resolve(window.jspdf.jsPDF);
  const existing = document.querySelector('script[data-mauex-jspdf="1"]');
  if (existing) {
    existing.addEventListener('load', () => resolve(window.jspdf.jsPDF), { once:true });
    existing.addEventListener('error', reject, { once:true });
    return;
  }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  s.async = true;
  s.dataset.mauexJspdf = '1';
  s.onload = () => resolve(window.jspdf.jsPDF);
  s.onerror = () => reject(new Error('No pude cargar el generador de PDF.'));
  document.head.appendChild(s);
});

async function getDashboardExportLiquidity() {
  if (window._liquidityCache?.balances) return window._liquidityCache;
  if (!PROXY_URL) return null;
  try {
    const r = await fetch(`${PROXY_URL}/balance?live=1&t=${Date.now()}`, { cache:'no-store' });
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = applyManualCapitalOverlay(await r.json());
    _liquidityCache = data;
    window._liquidityCache = data;
    return data;
  } catch (e) {
    console.warn('Dashboard PDF liquidity failed', e);
    return window._liquidityCache || null;
  }
}

function monthlyPnlRows(trades) {
  const months = {};
  trades.forEach(t => {
    const d = new Date(historyCloseDateOf(t) || t.closeDate || t.createdAt || 0);
    if (Number.isNaN(d.getTime())) return;
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months[k] = (months[k] || 0) + dashPnl(t);
  });
  return Object.keys(months).sort().map(k => ({ month:k, pnl:months[k] }));
}

window.exportDashboardPdf = async () => {
  const G = window.G;
  if (!G) return;
  const all = G.trades();
  const closed = all.filter(t => t.status === 'closed');
  if (!closed.length) {
    toast('No hay historial cerrado para exportar.','error');
    return;
  }

  try {
    toast('Preparando PDF del dashboard...');
    const [jsPDF, liquidity] = await Promise.all([loadJsPdf(), getDashboardExportLiquidity()]);
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;
    let y = 42;

    const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
    const money = v => `${Number(v||0) >= 0 ? '+' : '-'}$${fmt(Math.abs(Number(v||0)))}`;
    const moneyPlain = v => `$${fmt(Math.abs(Number(v||0)))}`;
    const dateOnly = v => {
      if (!v) return '';
      const s = String(v);
      return s.includes('T') ? s.split('T')[0] : s;
    };
    const addPageIfNeeded = (need=42) => {
      if (y + need <= pageH - margin) return;
      doc.addPage();
      y = margin;
    };
    const text = (value, x, opts={}) => {
      const size = opts.size || 9;
      const maxWidth = opts.maxWidth || pageW - margin - x;
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(opts.color || '#111827');
      const lines = doc.splitTextToSize(clean(value), maxWidth);
      addPageIfNeeded(lines.length * (size + 3));
      doc.text(lines, x, y);
      y += lines.length * (size + 3);
    };
    const section = title => {
      addPageIfNeeded(54);
      y += y === margin ? 0 : 14;
      doc.setDrawColor(210, 216, 226);
      doc.line(margin, y, pageW - margin, y);
      y += 18;
      doc.setFont('helvetica','bold');
      doc.setFontSize(13);
      doc.setTextColor('#0f172a');
      doc.text(title, margin, y);
      y += 18;
    };
    const table = (headers, rows, widths) => {
      const rowH = 17;
      addPageIfNeeded(rowH * 2);
      doc.setFont('helvetica','bold');
      doc.setFontSize(7.5);
      doc.setTextColor('#64748b');
      let x = margin;
      headers.forEach((h,i) => { doc.text(clean(h), x, y); x += widths[i]; });
      y += 9;
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageW - margin, y);
      y += 10;
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.5);
      doc.setTextColor('#111827');
      rows.forEach(row => {
        addPageIfNeeded(rowH);
        x = margin;
        row.forEach((cell,i) => {
          const cellText = doc.splitTextToSize(clean(cell), Math.max(20, widths[i] - 4))[0] || '';
          doc.text(cellText, x, y);
          x += widths[i];
        });
        y += rowH;
      });
    };

    const stats = dashStatsOf(closed);
    const signalStats = signalStatsOf(closed);
    const active = all.filter(t => t.status === 'active');
    const pending = all.filter(t => t.status === 'pending');
    const watch = all.filter(t => t.status === 'watchlist');
    const activePnl = active.reduce((s,t) => {
      const p = G.getPrice(t.ticker, t.dir);
      if (p == null || !Number(t.entry) || !Number(t.posSize)) return s;
      return s + Math.round((t.posSize/t.entry)*(t.entry-p)*(t.dir==='short'?1:-1)*100)/100;
    }, 0);
    const activeRisk = active.reduce((s,t)=>s+openRiskOf(t),0);
    const best = closed.reduce((b,t)=>dashPnl(t)>dashPnl(b)?t:b, closed[0]);
    const worst = closed.reduce((w,t)=>dashPnl(t)<dashPnl(w)?t:w, closed[0]);

    doc.setFont('helvetica','bold');
    doc.setFontSize(20);
    doc.setTextColor('#0f172a');
    doc.text('MAUex - Dashboard + Historial', margin, y);
    y += 22;
    text(`Generado: ${new Date().toLocaleString('es-AR')} | Trades cerrados: ${closed.length} | Posiciones: ${active.length} | Ordenes: ${pending.length} | Watchlist: ${watch.length}`, margin, { size:9, color:'#475569' });

    section('Resumen ejecutivo');
    table(
      ['Metrica','Valor','Detalle'],
      [
        ['PnL total cerrado', money(stats.pnl), `${stats.count} trades`],
        ['Signal PnL', money(signalStats.signalPnl), 'Estimacion con plan original del trader'],
        ['Execution delta', money(signalStats.executionDelta), 'PnL real menos Signal PnL'],
        ['Win rate', `${Math.round(stats.winRate*100)}%`, `${stats.wins} wins / ${stats.losses} losses`],
        ['Profit factor', stats.profitFactor === Infinity ? 'INF' : stats.profitFactor.toFixed(2), 'Ganancias brutas / perdidas brutas'],
        ['Expectancy', money(stats.expectancy), 'Promedio esperado por trade'],
        ['Max drawdown', `-$${fmt(stats.maxDd)}`, 'Mayor caida acumulada'],
        ['Avg win / Avg loss', `+$${fmt(stats.avgWin)} / -$${fmt(Math.abs(stats.avgLoss))}`, 'Promedios de ganadores y perdedores'],
        ['R promedio', `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`, 'Solo trades con riesgo cargado'],
        ['Sharpe simple', stats.sharpe.toFixed(2), `Best ${best?.ticker || '-'} / Worst ${worst?.ticker || '-'}`],
        ['PnL abierto', money(activePnl), 'Posiciones activas con precio disponible'],
        ['Capital en riesgo abierto', moneyPlain(activeRisk), 'Riesgo por SL o margen si no hay SL'],
      ],
      [145, 115, 260]
    );

    section('Capital en exchanges');
    const rawBalances = liquidity?.balances || {};
    const balances = Object.entries(rawBalances).map(([ex,b]) => [ex, normalizeDashboardBalance(b)]);
    if (balances.length) {
      table(
        ['Exchange','Libre','Margen','Ordenes','PnL','Total'],
        balances.map(([ex,b]) => [
          ex,
          moneyPlain(b.free),
          moneyPlain(b.margin),
          moneyPlain(b.orders),
          money(b.pnl),
          moneyPlain(b.total || (b.free+b.margin+b.orders)),
        ]),
        [90, 82, 82, 82, 82, 100]
      );
    } else {
      text('No habia datos de capital sincronizados al momento de exportar.', margin, { color:'#64748b' });
    }

    section('PnL mensual');
    table(['Mes','PnL'], monthlyPnlRows(closed).map(r => [r.month, money(r.pnl)]), [130, 130]);

    section('Ranking por trader');
    table(
      ['Trader','Trades','PnL','WR','PF','Expectancy'],
      dashGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').map(r => {
        const s = r.stats;
        return [r.name, s.count, money(s.pnl), `${Math.round(s.winRate*100)}%`, s.profitFactor === Infinity ? 'INF' : s.profitFactor.toFixed(2), money(s.expectancy)];
      }),
      [145, 52, 78, 55, 55, 90]
    );

    section('Signal vs Real por trader');
    table(
      ['Trader','Trades','Signal','Real','Delta','Lectura'],
      signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').map(r => {
        const delta = r.signal.executionDelta;
        return [r.name, r.stats.count, money(r.signal.signalPnl), money(r.signal.realPnl), money(delta), Math.abs(delta) < 1 ? 'Neutral' : delta > 0 ? 'Gestion suma' : 'Se pierde edge'];
      }),
      [130, 48, 74, 74, 74, 112]
    );

    section('Trader Signal Dashboard');
    table(
      ['Trader','Signal','Estado','Captura','Real','Delta','Signal PF','Signal WR'],
      signalGroupStats(closed, t => t.traderName || t.traderId || 'Sin trader').map(r => {
        const state = traderEdgeState(r);
        const meta = traderScoreMeta(r);
        const ss = signalPerformanceStatsOf(r.trades);
        return [
          r.name,
          meta.signalScore,
          state.label,
          meta.capture == null ? '-' : `${meta.capture}%`,
          money(r.signal.realPnl),
          money(r.signal.executionDelta),
          ss.profitFactor === Infinity ? 'INF' : ss.profitFactor.toFixed(2),
          `${Math.round(ss.winRate*100)}%`,
        ];
      }),
      [100, 42, 72, 62, 62, 62, 42, 42]
    );

    section('Portfolio Exposure Engine');
    const exposure = portfolioExposureStats(all);
    table(
      ['Metrica','Valor','Detalle'],
      [
        ['Long + Spot', moneyPlain(exposure.long + exposure.spot), 'Capital abierto long y spot'],
        ['Short', moneyPlain(exposure.short), 'Capital abierto short'],
        ['Net exposure', money(exposure.net), 'Long + spot menos shorts'],
        ['Riesgo abierto', moneyPlain(exposure.risk), 'SL o margen si no hay SL'],
      ],
      [150, 110, 250]
    );
    table(
      ['Exchange','Capital'],
      topExposureRows(exposure.byExchange, 10).map(([k,v]) => [k, moneyPlain(v)]),
      [160, 110]
    );

    section('Alertas inteligentes');
    const alerts = smartAlertsForDashboard(all, closed);
    table(
      ['Alerta','Detalle'],
      alerts.length ? alerts.map(a => [a.title, a.text]) : [['Sin alertas criticas', 'No se detectaron alertas fuertes al exportar.']],
      [160, 360]
    );

    section('AI Review System');
    const review = aiReviewStatus(closed);
    table(
      ['Estado','Valor','Detalle'],
      [
        ['Revision recomendada', review.needsReview ? 'SI' : 'NO', review.reason],
        ['Dias desde review', review.days == null ? '-' : review.days, 'Segun marca local en MAUex'],
        ['Trades desde review', review.tradesSince, 'Trades cerrados desde ultima revision marcada'],
      ],
      [150, 90, 280]
    );

    section('Asignacion de capital por trader');
    table(
      ['Trader','Signal','Estado','Allocation','Muestra'],
      capitalAllocationRows(closed).map(r => [r.name, r.score, r.state.label, `${r.allocationPct}%`, r.sample.label]),
      [145, 52, 90, 75, 90]
    );

    section('Backtesting de senales');
    table(
      ['Trader','Trades','Signal','Real','Captura','TP/SL/Manual'],
      signalBacktestRows(closed).map(r => [
        r.name,
        r.stats.count,
        money(r.signal.signalPnl),
        money(r.signal.realPnl),
        r.capture == null ? '-' : `${r.capture}%`,
        `${r.tp}/${r.sl}/${r.manual}`,
      ]),
      [130, 48, 78, 78, 70, 110]
    );

    section('Ranking por activo');
    table(
      ['Ticker','Trades','PnL','WR','PF','Expectancy'],
      dashGroupStats(closed, t => (t.ticker || 'Sin ticker').toUpperCase()).map(r => {
        const s = r.stats;
        return [r.name, s.count, money(s.pnl), `${Math.round(s.winRate*100)}%`, s.profitFactor === Infinity ? 'INF' : s.profitFactor.toFixed(2), money(s.expectancy)];
      }),
      [145, 52, 78, 55, 55, 90]
    );

    section('Calidad de ejecucion');
    const scored = closed.map(t => ({ trade:t, quality:tradeQualityOf(t, stats) })).sort((a,b)=>a.quality.score-b.quality.score);
    const tagCounts = {};
    scored.forEach(x => x.quality.tags.forEach(tag => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }));
    const avgScore = Math.round(scored.reduce((s,x)=>s+x.quality.score,0) / scored.length);
    text(`Score promedio: ${avgScore}/100`, margin, { bold:true });
    table(
      ['Error repetido','Veces'],
      Object.keys(tagCounts).sort((a,b)=>tagCounts[b]-tagCounts[a]).map(tag => [tag, tagCounts[tag]]),
      [220, 70]
    );
    table(
      ['A revisar','Score','PnL','Tags'],
      scored.slice(0,10).map(x => [x.trade.ticker || '-', x.quality.score, money(dashPnl(x.trade)), x.quality.tags.slice(0,4).join(', ')]),
      [85, 55, 75, 305]
    );

    section('Posiciones y ordenes abiertas');
    const openRows = [...active, ...pending, ...watch].map(t => [
      t.status === 'active' ? 'Posicion' : t.status === 'pending' ? 'Orden' : 'Watch',
      t.ticker || '',
      String(t.dir || '').toUpperCase(),
      t.exchange || '',
      t.traderName || '',
      t.entry || '',
      t.sl || '',
      [t.tp1,t.tp2,t.tp3].filter(Boolean).join(' / '),
      moneyPlain(t.posSize || 0),
    ]);
    table(['Tipo','Ticker','Dir','Exchange','Trader','Entry','SL','TPs','Nominal'], openRows, [58, 60, 44, 62, 82, 58, 58, 100, 70]);

    section('Historial completo');
    table(
      ['Ticker','Dir','Trader','Exit','Signal','Real','Delta','Cierre','Notas'],
      closed.sort((a,b)=>(new Date(historyCloseDateOf(a)||0))-(new Date(historyCloseDateOf(b)||0))).map(t => {
        const se = signalExecutionOf(t);
        return [
        t.ticker || '',
        String(t.dir || '').toUpperCase(),
        t.traderName || '',
        t.closePrice || t.exitPrice || t.exit || '',
        money(se.signalPnl),
        money(se.realPnl),
        money(se.executionDelta),
        dateOnly(historyCloseDateOf(t)),
        historyNotesOf(t),
        ];
      }),
      [50, 34, 70, 48, 62, 62, 62, 58, 160]
    );

    doc.save(`mauex_dashboard_${new Date().toISOString().split('T')[0]}.pdf`);
    toast('PDF del dashboard descargado.');
  } catch (e) {
    console.error(e);
    toast('No pude generar el PDF: '+(e.message || e),'error');
  }
};

window.deleteExchangeTrades = async () => {
  if(!confirm('¿Borrar todos los trades importados automáticamente del exchange? Los trades manuales y del watchlist se mantienen.')) return;
  const G = window.G; if(!G) return;
  try {
    const exchangeTrades = G.trades().filter(t=>t.exchangeSource||t.closeNotes?.includes('automáticamente')||t.entry===0);
    if(!exchangeTrades.length){ toast('No hay trades de exchange para borrar.'); return; }
    for(const t of exchangeTrades){
      await window._fb.deleteDoc(window._fb.doc(window._fb.db,'trades',t.id));
    }
    await window._loadTrades();
    renderHistory();
    renderDashboard();
    toast(`${exchangeTrades.length} trades de exchange eliminados.`);
  } catch(e){ toast('Error: '+e.message,'error'); }
};

// ── Delete all trades ────────────────────────────────────────────────────
window.deleteAllData = async () => {
  if(!confirm('¿Borrar TODOS los trades del historial? Esta acción no se puede deshacer.')) return;
  if(!confirm('¿Estás seguro? Se borrarán todos los trades permanentemente.')) return;
  const G = window.G; if(!G) return;
  try {
    const all = G.trades();
    for(const t of all){
      await window._fb.deleteDoc(window._fb.doc(window._fb.db,'trades',t.id));
    }
    await window._loadTrades();
    renderDashboard();
    toast('Todos los trades eliminados.');
  } catch(e){ toast('Error: '+e.message,'error'); }
};

// ── Proxy URL management ────────────────────────────────────────────────────
window.saveProxyUrl = () => {
  const url = document.getElementById('proxyUrl')?.value?.trim();
  if(url) {
    localStorage.setItem('mauex_proxy', url);
    // Update PROXY_URL - need to reload to take effect
    const st = document.getElementById('proxyStatus');
    if(st){ st.textContent='✅ Guardado. Recargá la página para aplicar.'; st.style.display='block'; st.style.color='var(--accent)'; }
  } else {
    localStorage.removeItem('mauex_proxy');
    const st = document.getElementById('proxyStatus');
    if(st){ st.textContent='Proxy eliminado.'; st.style.display='block'; st.style.color='var(--t2)'; }
  }
};

window.testProxyUrl = async () => {
  const url = document.getElementById('proxyUrl')?.value?.trim() || PROXY_URL;
  const st = document.getElementById('proxyStatus');
  if(!url){ if(st){ st.textContent='Ingresá una URL primero.'; st.style.display='block'; } return; }
  if(st){ st.textContent='⟳ Probando...'; st.style.display='block'; st.style.color='var(--t2)'; }
  try {
    const r = await fetch(`${url}/health`);
    const d = await r.json();
    if(d.status==='ok'){
      if(st){ st.textContent='✅ Proxy funcionando correctamente.'; st.style.color='var(--accent)'; }
    } else {
      if(st){ st.textContent='⚠️ Proxy respondió pero con estado inesperado.'; st.style.color='var(--amber)'; }
    }
  } catch(e) {
    if(st){ st.textContent=`❌ Error: ${e.message}`; st.style.color='var(--red)'; }
  }
};

// Load proxy URL into settings field
function loadProxyUrlField() {
  const el = document.getElementById('proxyUrl');
  if(el) el.value = localStorage.getItem('mauex_proxy') || '';
}

// ── Open trade in AI Analysis with levels drawn ─────────────────────────────
let _analysisTradeData = null; // trade to draw on charts

window.openTradeInAnalysis = (id) => {
  const G = window.G; if(!G) return;
  const t = G.trades().find(x=>x.id===id);
  if(!t){ toast('Trade no encontrado','error'); return; }

  _analysisTradeData = t;

  // Detect if crypto or stock/etf
  const rawTicker = t.ticker||'';
  const isCryptoTicker = rawTicker.endsWith('USDT') || rawTicker.endsWith('BUSD') ||
    ['BTC','ETH','SOL','BNB','XRP','ADA','DOT','AVAX','MATIC','LINK','DOGE','LTC',
     'XLM','TRX','ATOM','NEAR','AAVE','UNI','ONDO','XMR','ANKR'].includes(rawTicker.toUpperCase());

  const aiSym = document.getElementById('aiSymbol');
  if(isCryptoTicker) {
    const sym = rawTicker.replace(/USDT|BUSD|USD$/,'').toUpperCase();
    if(aiSym) aiSym.value = sym+'USDT';
    window._aiSource = 'binance';
    window._aiType   = 'crypto';
    // Default to futures for crypto trades
    setMarketType(t.dir==='spot'?'spot':'futures');
  } else {
    // Stock/ETF/Commodity — use ticker directly for Yahoo
    if(aiSym) aiSym.value = rawTicker;
    window._aiSource = 'yahoo';
    window._aiType   = 'stock';
    setMarketType('spot');
  }

    // Navigate to analysis and auto-load charts
  window.showPage('analysis');
  // Small delay to let the page render first
  setTimeout(() => {
    if(typeof loadCharts === 'function') loadCharts();
  }, 300);
};

// Draw trade levels on a LW chart
function drawTradeLevels(csChart, trade) {
  if(!csChart||!trade) return;
  if(!trade.entry) return;

  const G = window.G;
  // Get last candle time for extending lines
  const levels = [
    {price:trade.entry, color:'rgba(232,237,243,0.8)',  title:'Entry'},
    ...(trade.sl?  [{price:trade.sl,   color:'rgba(240,61,61,0.8)',   title:'SL'}]:[]),
    ...(trade.tp1? [{price:trade.tp1,  color:'rgba(0,196,122,0.6)',   title:'TP1'}]:[]),
    ...(trade.tp2? [{price:trade.tp2,  color:'rgba(0,196,122,0.75)',  title:'TP2'}]:[]),
    ...(trade.tp3? [{price:trade.tp3,  color:'rgba(0,196,122,0.9)',   title:'TP3'}]:[]),
  ];

  levels.forEach(lvl => {
    try {
      const line = csChart.addLineSeries({
        color: lvl.color,
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: true,
        title: lvl.title,
        crosshairMarkerVisible: false,
      });
      // We need at least 2 points for a line - use a priceLine instead
      csChart.removeSeries(line); // remove the temp series
      
      // Use price line (horizontal line across whole chart)
      const pl = {price: lvl.price, color: lvl.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: lvl.title};
      // Add to candlestick series - need reference to it
    } catch(e){}
  });
}

// Show trade info panel in AI Analysis
function renderTradeInfoPanel(trade) {
  const panel = document.getElementById('aiTradePanel');
  if(!panel||!trade) { if(panel) panel.style.display='none'; return; }

  const rr = trade.tp1&&trade.entry&&trade.sl ?
    Math.abs((trade.tp1-trade.entry)/(trade.entry-trade.sl)).toFixed(2) : '—';

  panel.style.display='block';
  panel.innerHTML=`
    <div style="background:var(--bg2);border:0.5px solid var(--border2);border-radius:var(--r);padding:12px 16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-family:var(--mono);font-size:14px;font-weight:600;">${trade.ticker}</span>
        <span class="badge ${trade.dir==='long'?'bl':trade.dir==='short'?'bs':'bsp'}">${(trade.dir||'').toUpperCase()}${(trade.leverage||1)>1?' x'+(trade.leverage||1):''}</span>
        ${trade.traderName?`<span style="font-size:11px;color:var(--t2);">· ${trade.traderName}</span>`:''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-family:var(--mono);font-size:11px;">
        <div><div style="color:var(--t3);font-size:9px;">ENTRY</div><div>$${fmtPx(trade.entry)}</div></div>
        <div><div style="color:var(--t3);font-size:9px;">STOP LOSS</div><div style="color:var(--red);">$${fmtPx(trade.sl)}</div></div>
        <div><div style="color:var(--t3);font-size:9px;">RIESGO</div><div style="color:var(--amber);">$${fmt(trade.risk)}</div></div>
        ${trade.tp1?`<div><div style="color:var(--t3);font-size:9px;">TP1</div><div style="color:var(--accent);">$${fmtPx(trade.tp1)}</div></div>`:''}
        ${trade.tp2?`<div><div style="color:var(--t3);font-size:9px;">TP2</div><div style="color:var(--accent);">$${fmtPx(trade.tp2)}</div></div>`:''}
        ${trade.tp3?`<div><div style="color:var(--t3);font-size:9px;">TP3</div><div style="color:var(--accent);">$${fmtPx(trade.tp3)}</div></div>`:''}
        <div><div style="color:var(--t3);font-size:9px;">R:R</div><div style="color:${rr>=2?'var(--accent)':'var(--red)'};">${rr}:1</div></div>
        <div><div style="color:var(--t3);font-size:9px;">POSICIÓN</div><div>$${fmt(trade.posSize)}</div></div>
      </div>
      ${trade.notes?`<div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--border);font-size:10px;color:var(--t2);">${trade.notes}</div>`:''}
    </div>`;
}

// ── Status bar update ────────────────────────────────────────────────────────
function updateStatusBar() {
  const G = window.G; if(!G) return;
  const bar = document.getElementById('statusBar');
  if(!bar) return;
  bar.style.display = 'flex';

  const allTrades = G.trades();
  const manPos = allTrades.filter(t=>t.status==='active');
  const manualOrders = allTrades.filter(t=>t.status==='pending');
  const totalPos = manPos.length;
  const totalOrders = manualOrders.length;

  let totalPnl = 0;
  let missingPrices = 0;
  manPos.forEach(t => {
    const entry = Number(t.entry) || 0;
    const size = Number(t.posSize) || 0;
    const price = G.getPrice(t.ticker, t.dir);
    if (!entry || !size || !price) { missingPrices++; return; }
    const sign = t.dir === 'short' ? -1 : 1;
    totalPnl += Math.round((size / entry) * (price - entry) * sign * 100) / 100;
  });
  const totalRisk = manPos.reduce((s,t)=>s+openRiskOf(t),0);
  const noSlCount = manPos.filter(t=>!Number(t.sl)).length;

  const dot = document.getElementById('sbDot');
  const sbPos = document.getElementById('sbPositions');
  const sbPnl = document.getElementById('sbPnl');
  const sbOrd = document.getElementById('sbOrders');
  const sbRisk = document.getElementById('sbRisk');
  const sbBtc = document.getElementById('sbBtc');

  if(dot) dot.className = 'status-dot' + (totalPos>0?'':' amber');
  if(sbPos) sbPos.textContent = `${totalPos} posición${totalPos!==1?'es':''}`;
  if(sbPnl) {
    const missing = missingPrices ? ` (${missingPrices} sin precio)` : '';
    sbPnl.textContent = totalPos>0 ? `PnL ${totalPnl>=0?'+':'-'}$${Math.abs(totalPnl).toFixed(0)}${missing}` : 'PnL —';
    sbPnl.style.color = totalPnl>=0?'var(--accent)':'var(--red)';
  }
  if(sbOrd) sbOrd.textContent = `${totalOrders} orden${totalOrders!==1?'es':''}`;
  if(sbRisk) {
    sbRisk.textContent = `riesgo $${Math.round(totalRisk).toLocaleString('en-US')}${noSlCount ? ` (${noSlCount} sin SL)` : ''}`;
    sbRisk.style.color = totalRisk ? 'var(--red)' : 'var(--t3)';
  }

  // BTC price
  const btcPrice = G.getPrice('BTCUSDT','futures') || G.getPrice('BTC','futures');
  if(sbBtc && btcPrice) sbBtc.textContent = `BTC $${Math.round(btcPrice).toLocaleString('en-US')}`;
}

// Update status bar every 2s
setInterval(updateStatusBar, 2000);

// ── Favorite pairs ────────────────────────────────────────────────────────────
function loadFavPairs() {
  try {
    const stored = localStorage.getItem('mauex_favpairs');
    return stored ? JSON.parse(stored) : ['BTCUSDT','ETHUSDT','SOLUSDT'];
  } catch(e){ return ['BTCUSDT','ETHUSDT']; }
}

function saveFavPairs(pairs) {
  localStorage.setItem('mauex_favpairs', JSON.stringify(pairs));
}

function renderFavPairsBar() {
  const bar = document.getElementById('favPairsBar');
  if(!bar) return;
  const pairs = loadFavPairs();
  bar.innerHTML = pairs.map(p=>`
    <button onclick="selectFavPair('${p}')" style="
      padding:4px 10px;border-radius:20px;border:0.5px solid var(--border2);
      background:var(--bg3);color:var(--t2);font-family:var(--mono);font-size:10px;
      cursor:pointer;transition:all .2s;" 
      onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
      onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--t2)'">
      ${p}
    </button>`).join('');
}

window.selectFavPair = (sym) => {
  const el = document.getElementById('aiSymbol');
  if(el) el.value = sym;
  _analysisTradeData = null;
  // Auto-detect type
  window._aiType = sym.endsWith('USDT')||sym.endsWith('BUSD') ? 'crypto' : 'stock';
  window._aiSource = window._aiType==='crypto' ? 'binance' : 'yahoo';
  loadCharts();
};

window.toggleFavPair = () => {
  const sym = document.getElementById('aiSymbol')?.value?.trim().toUpperCase();
  if(!sym) return;
  const pairs = loadFavPairs();
  const idx = pairs.indexOf(sym);
  if(idx>-1) {
    pairs.splice(idx,1);
    toast(`${sym} eliminado de favoritos`);
  } else {
    pairs.unshift(sym);
    if(pairs.length>10) pairs.pop();
    toast(`${sym} guardado como favorito ★`);
  }
  saveFavPairs(pairs);
  renderFavPairsBar();
};

// ── Open import history modal ─────────────────────────────────────────────────
window.openImportHistoryModal = () => {
  const today = new Date().toISOString().split('T')[0];
  const fromEl = document.getElementById('importFrom');
  const toEl   = document.getElementById('importTo');
  if(fromEl) fromEl.value = '2026-01-01';
  if(toEl)   toEl.value   = today;
  document.getElementById('importHistProgress').style.display='none';
  document.getElementById('importHistProgress').textContent='';
  openModal('importHistoryModal');
};

window.runImportHistory = async () => {
  const fromDate = document.getElementById('importFrom')?.value;
  const toDate   = document.getElementById('importTo')?.value;
  if(!fromDate){ toast('Seleccioná fecha desde.','error'); return; }

  const prog = document.getElementById('importHistProgress');
  prog.style.display='block';
  prog.innerHTML = '⟳ Importando desde los exchanges...';

  try {
    // Call Worker to fetch history (Worker has the keys, no CORS issues)
    const url = `${PROXY_URL}/position-history?from=${fromDate}&to=${toDate||new Date().toISOString().split('T')[0]}`;
    const r   = await fetch(url);
    if(!r.ok) throw new Error(`Worker error: ${r.status}`);
    const data = await r.json();

    if(data.error) throw new Error(data.error);

    const trades  = data.trades || [];
    const G       = window.G;
    const existing = new Set((G?.trades()||[]).map(t=>t.exchangeId).filter(Boolean));
    let saved = 0;

    for(const t of trades) {
      if(existing.has(t.exchangeId)) continue;
      try {
        await window._fb.addDoc(window._fb.collection(window._fb.db,'trades'),
          { userId:window._getCU()?.uid, ...t });
        saved++;
      } catch(e){}
    }

    if(saved>0) {
      await window._loadTrades();
      renderHistory();
      renderDashboard();
    }

    const lines = data.summary || [];
    prog.innerHTML = lines.join('<br>') + `<br><strong>✅ ${saved} trades guardados en historial</strong>`;
    toast(`Importación completa: ${saved} trades`);
  } catch(e) {
    prog.innerHTML = `❌ Error: ${e.message}`;
    toast('Error al importar: ' + e.message, 'error');
  }
};

// ── Orders rendering ─────────────────────────────────────────────────────────
let exchangeOrders = [];

// ── Order selection and grouping ─────────────────────────────────────────────
let _selectedOrders = new Set();

window.toggleOrderSelect = (id) => {
  if(_selectedOrders.has(id)) _selectedOrders.delete(id);
  else _selectedOrders.add(id);
  const btn = document.getElementById('groupOrdersBtn');
  if(btn) btn.style.display = _selectedOrders.size >= 2 ? 'block' : 'none';
};

window.groupSelectedOrders = () => {
  if(_selectedOrders.size < 2) { toast('Seleccioná al menos 2 órdenes','error'); return; }
  const selected = exchangeOrders.filter(o => _selectedOrders.has(o.exchangeId));
  if(!selected.length) return;

  // Use first order as base
  const base      = selected[0];
  const totalSize = selected.reduce((s,o) => s+(o.size||0), 0);

  // Separate entry orders from TP/SL orders
  const entryOrders = selected.filter(o => o.type==='LIMIT'||o.type==='Limit'||o.type==='limit');
  const tpOrders    = selected.filter(o => (o.type||'').toUpperCase().includes('TAKE') || (o.type||'').toUpperCase().includes('TP'));
  const slOrders    = selected.filter(o => (o.type||'').toUpperCase().includes('STOP') || (o.type||'').toUpperCase().includes('SL'));

  // Build TPs sorted by distance from entry
  const tpPrices = tpOrders.length
    ? tpOrders.map(o=>o.price).sort((a,b) => base.dir==='long' ? a-b : b-a)
    : selected.filter(o=>o!==base).map(o=>o.price).sort((a,b) => base.dir==='long' ? a-b : b-a);

  // Create grouped virtual order
  const grouped = {
    exchange:   base.exchange,
    type:       'GROUPED',
    ticker:     base.ticker,
    symbol:     base.symbol,
    dir:        base.dir,
    price:      base.price,
    sl:         slOrders[0]?.price || null,
    tp1:        tpPrices[0] || null,
    tp2:        tpPrices[1] || null,
    tp3:        tpPrices[2] || null,
    size:       totalSize,
    origQty:    selected.reduce((s,o)=>s+(o.origQty||0),0),
    exchangeId: 'grouped-' + Date.now(),
    groupedFrom: selected.map(o=>o.exchangeId),
  };

  // Remove individual orders and add grouped one
  const ids = new Set(selected.map(o=>o.exchangeId));
  exchangeOrders = exchangeOrders.filter(o => !ids.has(o.exchangeId));
  exchangeOrders.unshift(grouped);
  window.exchangeOrders = exchangeOrders;

  // Persist grouped orders in localStorage
  saveGroupedOrders();

  // Clear selection
  _selectedOrders.clear();
  const btn = document.getElementById('groupOrdersBtn');
  if(btn) btn.style.display = 'none';

  renderOrders();
  toast(`✅ ${selected.length} órdenes agrupadas como un trade`);
};

// Persist and restore grouped orders
function saveGroupedOrders() {
  const grouped = exchangeOrders.filter(o => o.type === 'GROUPED');
  localStorage.setItem('mauex_grouped_orders', JSON.stringify(grouped));
}

function loadGroupedOrders() {
  try {
    const saved = localStorage.getItem('mauex_grouped_orders');
    return saved ? JSON.parse(saved) : [];
  } catch(e) { return []; }
}

window.ungroupOrder = (exchangeId) => {
  const grouped = exchangeOrders.find(o => o.exchangeId === exchangeId);
  if(!grouped || !grouped.groupedFrom) return;
  // Remove grouped order
  exchangeOrders = exchangeOrders.filter(o => o.exchangeId !== exchangeId);
  window.exchangeOrders = exchangeOrders;
  // Remove from localStorage
  saveGroupedOrders();
  // Re-sync to get original orders back
  window.syncAllOrders();
  toast('Orden desagrupada');
};

function renderOrders() {
  const container = document.getElementById('ordersList');
  if(!container) return;

  if(!_masterPass || !window.G?._hasExchangeKeys?.()) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">◻</div>
      <div class="empty-text">Conectá tus exchanges para ver órdenes</div>
      <button class="btn acc sm" style="margin-top:12px;" onclick="window.showPage('settings')">⚙ Configurar</button>
    </div>`;
    return;
  }

  // Merge exchange orders + manual orders from Firestore (status='pending')
  const manualOrders = (window.G?.trades().filter(t=>t.status==='pending')||[]).map(t=>({
    ...t,
    _manual: true,
    exchange: ((t.exchange||'BINANCE')+'').toUpperCase(),
    ticker:   (t.ticker||'').replace(/USDT|BUSD|USD$/,'').toUpperCase() || t.ticker || '?',
    entry:    t.entry || 0,
    totalSize: effectiveTradeSize(t),
    sl:       t.sl||null,
    tp1:      t.tp1||null,
    tp2:      t.tp2||null,
    tp3:      t.tp3||null,
    leverage: t.leverage||null,
    status:   'PENDIENTE',
    exchangeId: t.id,
  })).filter(o => o.entry > 0);

  const allOrders = [...manualOrders];

  if(!allOrders.length) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">◻</div>
      <div class="empty-text">No hay órdenes pendientes</div>
      <div class="empty-sub">Usá la calculadora para enviar órdenes aquí</div>
    </div>`;
    return;
  }

  // Sort by distance to entry (closest = executes soonest = first)
  const sortedOrders = [...allOrders].sort((a, b) => {
    const G = window.G;
    const symA = a.ticker?.replace(/USDT|BUSD$/,'').toUpperCase() || a.ticker;
    const symB = b.ticker?.replace(/USDT|BUSD$/,'').toUpperCase() || b.ticker;
    const pA = G?.getPrice(symA, a.dir) || G?.getPrice(symA+'USDT', a.dir) || 0;
    const pB = G?.getPrice(symB, b.dir) || G?.getPrice(symB+'USDT', b.dir) || 0;
    const eA = a.entry || a.price || 0;
    const eB = b.entry || b.price || 0;
    const dA = pA&&eA ? Math.abs(pA-eA)/pA : Infinity;
    const dB = pB&&eB ? Math.abs(pB-eB)/pB : Infinity;
    return dA - dB;
  });

  const cardStates = getCardState();

  container.innerHTML = sortedOrders.map(o=>{
    const G = window.G;
    const sym = o.ticker?.replace(/USDT|BUSD$/,'').toUpperCase() || o.ticker;
    const currentPrice = G?.getPrice(sym, o.dir) || G?.getPrice(sym+'USDT', o.dir) || G?.getPrice(o.symbol?.replace(/USDT$/,''), o.dir) || 0;
    const entryPrice = o.entry || o.price || 0;
    const totalSize  = o.totalSize || o.size || 0;
    const unitsLabel = positionUnitsLabel(o, totalSize, entryPrice);
    const dist = currentPrice&&entryPrice ? ((entryPrice-currentPrice)/currentPrice*100) : null;
    const distAbs = dist!=null ? Math.abs(dist) : null;
    const distColor = distAbs==null?'var(--t3)':distAbs<1?'var(--accent)':distAbs<3?'var(--amber)':'var(--t2)';
    const exColor = o.exchange==='BINANCE'?'#f0b90b':o.exchange==='BYBIT'?'#f7a600':o.exchange==='MEXC'?'#00b8d9':o.exchange==='KUCOIN'?'#24ae8f':'#00a0ea';
    const lev = o.leverage || 1;
    const isSpotOrder = o.dir === 'spot';
    const liqApprox = lev > 1 ? (o.liquidation || estimatedLiquidationPrice({ ...o, entry:entryPrice })) : null;
    const sl  = o.sl  || null;
    const tp1 = o.tp1 || null;
    const tp2 = o.tp2 || null;
    const tp3 = o.tp3 || null;
    const fakeT = { entry:entryPrice, sl, tp1, tp2, tp3, dir:o.dir, liquidation: liqApprox, invalidations:o.invalidations };
    const distToOrder = currentPrice&&entryPrice ? fmtP((entryPrice-currentPrice)/currentPrice*100) : '—';
    const slDistPct = sl&&entryPrice ? Math.abs(sl-entryPrice)/entryPrice*100 : null;
    const riskUsd = totalSize&&slDistPct ? totalSize*slDistPct/100 : null;
    const tpList = [{l:'TP1',v:tp1,pct:o.tp1pct||33},{l:'TP2',v:tp2,pct:o.tp2pct||33},{l:'TP3',v:tp3,pct:o.tp3pct||34}].filter(x=>x.v);
    const entryTouched = hasAlert(o.id, 'entry');
    const entryBadge = entryTouched ? alertBadge('entry', 'badge-alert-slow') : '';
    const invalidAlert = getInvalidationAlert(o, currentPrice);
    const orderCardClass = entryTouched ? 'order-card hit-entry' : invalidAlert.cardClass ? 'order-card hit-invalidation' : 'order-card';
    const orderBorderColor = entryTouched ? 'var(--accent)' : 'var(--amber)';

    const isMin = !!cardStates[o.exchangeId];
    const cardId = o.exchangeId;
    const dirBadge = dirBadgeColors(o.dir);
    const dirColor  = dirBadge.color;
    const dirBg     = dirBadge.bg;
    const dirBorder = dirBadge.border;
    const rrFor = (tp) => {
      if (!tp||!sl||!entryPrice) return null;
      const reward = Math.abs(tp-entryPrice), risk = Math.abs(sl-entryPrice);
      return risk ? (reward/risk).toFixed(1) : null;
    };

    const collapseBtn = `<button onclick="window.toggleCardMin('${cardId}')"
      style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.35);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${isMin?'▼':'▲'}</button>`;

    const header = `
      <div style="padding:13px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--amber);flex-shrink:0;"></div>
            <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--t1);">${o.ticker}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${dirBg};color:${dirColor};font-family:var(--mono);border:0.5px solid ${dirBorder};">${dirLevLabel(o)}</span>
            <a href="${getExchangeUrl(o.exchange, o.ticker, o.dir)||'#'}" target="_blank" rel="noopener"
              style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2);text-decoration:none;">${o.exchange} ↗</a>
            <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--amber-dim);color:var(--amber);font-family:var(--mono);">PENDIENTE</span>
            ${o.traderName?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);">· ${o.traderName}</span>`:''}
            ${entryBadge}
            ${invalidAlert.badges?`<span style="display:inline-flex;gap:4px;">${invalidAlert.badges}</span>`:''}
            ${currentPrice?`<span style="font-size:10px;color:${distColor};font-family:var(--mono);">${distToOrder} al entry</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div style="text-align:right;">
            <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--t1);">$${fmtPx(entryPrice)}</div>
            <div style="font-size:10px;color:var(--t3);font-family:var(--mono);">$${fmt(totalSize)}${lev&&o.leverage?` · x${lev}`:''}</div>
          </div>
          ${collapseBtn}
        </div>
      </div>`;

    if (isMin) {
      return `<div class="${orderCardClass}" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${orderBorderColor};margin-bottom:8px;overflow:hidden;" id="order-card-${cardId}">
        ${header}
        ${entryPrice&&(sl||tp1)?`<div style="padding:0 16px 14px;">${buildPriceBar(fakeT, currentPrice||0)}</div>`:''}
      </div>`;
    }

    return `<div class="${orderCardClass}" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${orderBorderColor};margin-bottom:8px;overflow:hidden;" id="order-card-${cardId}">
      ${header}

      ${entryPrice&&(sl||tp1) ? `<div style="padding:0 16px 16px;">${buildPriceBar(fakeT, currentPrice||0)}</div>` : ''}

      ${isSpotOrder && (sl || totalSize) ? `
      <div style="display:grid;grid-template-columns:1fr 0.5px 1fr 0.5px 1fr 0.5px 1fr;border-top:0.5px solid var(--border2);border-bottom:0.5px solid var(--border2);">
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:${sl ? 'rgba(224,82,82,0.6)' : 'var(--blue)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${sl ? 'Riesgo a SL' : 'Capital reservado'}</div>
          ${sl ? `
            <div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--red);">-$${fmt(riskUsd||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">${slDistPct?slDistPct.toFixed(1)+'% entry':''}</div>
          ` : `
            <div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--blue);">$${fmt(totalSize||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">spot sin liquidacion</div>
          `}
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Capital de orden</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(totalSize)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Precio actual</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">${currentPrice ? '$'+fmtPx(currentPrice) : '-'}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Tamaño</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t2);">${unitsLabel}</div>
        </div>
      </div>` : ''}

      ${(!isSpotOrder && (sl || totalSize)) ? `
      <div style="display:grid;grid-template-columns:1fr 0.5px 1fr 0.5px 1fr 0.5px 1fr;border-top:0.5px solid var(--border2);border-bottom:0.5px solid var(--border2);">
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:${sl ? 'rgba(224,82,82,0.6)' : 'var(--amber)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">${sl ? 'SL Riesgo' : 'Riesgo en liq.'}</div>
          ${sl ? `
            <div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--red);">−$${fmt(riskUsd||0)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">${slDistPct?slDistPct.toFixed(1)+'% entry':''}</div>
          ` : `
            <div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--amber);">−$${fmt(o.dir==='spot'?totalSize:(totalSize/(lev||1)))}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:1px;">margen</div>
          `}
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Nominal</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(totalSize)}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Margen aprox.</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">${lev>1?'$'+fmt(totalSize/lev):'—'}</div>
        </div>
        <div style="background:var(--border2);"></div>
        <div style="padding:8px 14px;">
          <div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;">Tamaño</div>
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t2);">${unitsLabel}</div>
        </div>
      </div>` : ''}

      ${tpList.length ? `
      <div style="display:grid;grid-template-columns:${tpList.map(()=>'1fr').join(' ')};border-bottom:0.5px solid var(--border2);">
        ${tpList.map((tp,i) => {
          const tpColors = ['#4ade80','#22c55e','#16a34a'];
          const tpColor  = tpColors[i] || '#4ade80';
          const tpBg     = ['rgba(74,222,128,0.03)','rgba(34,197,94,0.03)','rgba(22,163,74,0.03)'][i]||'transparent';
          const distFromEntry = tp.v&&entryPrice ? Math.abs((tp.v-entryPrice)/entryPrice*100) : null;
          const tpPnlAmt = totalSize&&entryPrice ? Math.round((totalSize/entryPrice)*(tp.v-entryPrice)*(o.dir==='short'?-1:1)*(tp.pct/100)*100)/100 : null;
          const rr = rrFor(tp.v);
          return `<div style="padding:10px 14px;${i<tpList.length-1?'border-right:0.5px solid var(--border2);':''}background:${tpBg};">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:8px;color:${tpColor};opacity:0.6;text-transform:uppercase;letter-spacing:.06em;">${tp.l} · ${tp.pct}%</span>
              ${rr?`<span style="font-size:9px;font-family:var(--mono);color:#22c55e;">${rr}:1</span>`:''}
            </div>
            <div style="font-size:14px;font-weight:600;font-family:var(--mono);color:${tpColor};">$${fmtPx(tp.v)}</div>
            <div style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-top:2px;">
              ${distFromEntry!=null?`+${distFromEntry.toFixed(1)}%`:''} ${tpPnlAmt!=null?`· +$${fmt(tpPnlAmt)}`:''}
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${invalidationNotesHtml(o)}

      ${o._manual ? `
      <div style="display:grid;grid-template-columns:2fr 3fr 1fr 1fr;gap:8px;padding:10px 14px;background:rgba(0,0,0,0.15);">
        <select onchange="window.moveCardToStatus('${o.id}', this.value)"
          style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;">
          <option value="watchlist">👁 Watchlist</option>
          <option value="pending" selected>⏳ Órdenes</option>
          <option value="active">🟢 Posición</option>
        </select>
        <button style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:12px;font-weight:600;cursor:pointer;" onclick="openEditTrade('${o.id}')">Editar</button>
        <button style="background:var(--bg3);color:var(--t3);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="openEditTrade('${o.id}')">✎</button>
        <button style="background:rgba(224,82,82,0.08);color:var(--red);border:0.5px solid rgba(224,82,82,0.15);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="window.deletePendingOrder('${o.id}')">✕</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

// ── Manual order actions ─────────────────────────────────────────────────────

window.toggleZombie = async (id, makeZombie) => {
  const {updateDoc, doc, db} = window._fb;
  try {
    await updateDoc(doc(db,'trades',id), {
      status: makeZombie ? 'zombie' : 'active',
      updatedAt: new Date().toISOString()
    });
    await window._loadTrades();
    renderPositions();
    renderMap();
    toast(makeZombie ? '🧟 Archivado como zombie' : '↩ Restaurado a posiciones');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

window.moveCardToStatus = async (id, newStatus) => {
  const {updateDoc, doc, db} = window._fb;
  try {
    await updateDoc(doc(db,'trades',id), { status: newStatus, updatedAt: new Date().toISOString() });
    await window._loadTrades();
    renderWatchlist(); renderOrders(); renderPositions(); renderMap();
    const labels = {watchlist:'Watchlist', pending:'Órdenes', active:'Posiciones'};
    toast('Movido a ' + (labels[newStatus]||newStatus));
  } catch(e) { toast('Error: '+e.message,'error'); }
};
window.movePendingToWatchlist = async id => {
  try {
    const {updateDoc, doc, db} = window._fb;
    await updateDoc(doc(db,'trades',id), { status:'watchlist', updatedAt: new Date().toISOString() });
    await window._loadTrades();
    renderOrders();
    renderWatchlist();
    renderMap();
    toast('Movido a Watchlist.');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

window.moveWatchlistToPending = async id => {
  try {
    const {updateDoc, doc, db} = window._fb;
    await updateDoc(doc(db,'trades',id), { status:'pending', updatedAt: new Date().toISOString() });
    await window._loadTrades();
    renderOrders();
    renderWatchlist();
    renderMap();
    toast('Movido a Órdenes abiertas.');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

window.deletePendingOrder = async id => {
  if(!confirm('¿Eliminar esta orden?')) return;
  try {
    const {deleteDoc, doc, db} = window._fb;
    await deleteDoc(doc(db,'trades',id));
    await window._loadTrades();
    renderOrders();
    renderMap();
    toast('Orden eliminada.');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

// ── Fetch open orders from exchanges ─────────────────────────────────────────
async function fetchAllOrders() {
  const orders = [];
  const exchanges = ['binance','bybit','okx','mexc','kucoin'];
  for(const ex of exchanges) {
    const keys = await getDecryptedKeys(ex);
    if(!keys) continue;
    try {
      if(ex==='binance') {
        const ts  = Date.now();
        const q   = `timestamp=${ts}`;
        const sig = await hmacSHA256(keys.secret, q);
        const r   = await (window.proxyFetch||fetch)(
          `https://fapi.binance.com/fapi/v1/openOrders?timestamp=${ts}&signature=${sig}`,
          { headers:{'X-MBX-APIKEY':keys.key} }
        );
        const d = await r.json();
        if(Array.isArray(d)) d.forEach(o=>{
          orders.push({
            exchange:'BINANCE', ticker:o.symbol.replace('USDT',''),
            dir: o.side==='BUY'?'long':'short',
            type: o.type, price: parseFloat(o.price),
            size: parseFloat(o.origQty)*parseFloat(o.price),
            orderId: o.orderId,
          });
        });
      }
      if(ex==='bybit') {
        const ts  = Date.now().toString();
        const q   = 'category=linear&settleCoin=USDT';
        const msg = ts+keys.key+'5000'+q;
        const sig = await hmacSHA256(keys.secret, msg);
        const r   = await (window.proxyFetch||fetch)(
          `https://api.bybit.com/v5/order/realtime?${q}`,
          { headers:{'X-BAPI-API-KEY':keys.key,'X-BAPI-TIMESTAMP':ts,'X-BAPI-SIGN':sig,'X-BAPI-RECV-WINDOW':'5000'} }
        );
        const txt = await r.text();
        let d; try{d=JSON.parse(txt);}catch(e){continue;}
        if(d.retCode===0&&d.result?.list) d.result.list.forEach(o=>{
          orders.push({
            exchange:'BYBIT', ticker:o.symbol.replace('USDT',''),
            dir: o.side==='Buy'?'long':'short',
            type: o.orderType, price: parseFloat(o.price),
            size: parseFloat(o.qty)*parseFloat(o.price),
            orderId: o.orderId,
          });
        });
      }
    } catch(e){ console.warn(`fetchOrders ${ex}:`, e); }
  }
  return orders;
}

window.syncAllOrders = async () => {
  const btn = document.getElementById('syncOrdersBtn');
  if(btn){ btn.textContent='⟳ Cargando...'; btn.disabled=true; }
  try {
    if(PROXY_URL) {
      const r = await fetch(`${PROXY_URL}/orders`);
      const d = await r.json();
      const freshOrders = d.orders || [];
      // Restore grouped orders (remove any that are now individual)
      const grouped = loadGroupedOrders();
      const groupedFromIds = new Set(grouped.flatMap(g => g.groupedFrom || []));
      const filtered = freshOrders.filter(o => !groupedFromIds.has(o.exchangeId));
      exchangeOrders = [...grouped, ...filtered];
    } else {
      if(!_masterPass) { if(btn){btn.disabled=false;btn.textContent='↻ Sync órdenes';} return; }
      exchangeOrders = await fetchAllOrders();
    }
    window.exchangeOrders = exchangeOrders;
    renderOrders();
    updateStatusBar();
    if(btn){ btn.textContent=`↻ ${exchangeOrders.length} órdenes`; btn.disabled=false; }
  } catch(e) {
    console.error('syncAllOrders:', e);
    if(btn){ btn.textContent='↻ Sync órdenes'; btn.disabled=false; }
  }
};

// ── Update fetchExchangeHistory to accept date range ──────────────────────────
// Wrap existing function with date params
const _origFetchHistory = typeof fetchExchangeHistory !== 'undefined' ? fetchExchangeHistory : null;
// Override to add MEXC support and date range
async function fetchExchangeHistory(exchange, keys, startTs, endTs) {
  startTs = startTs || new Date('2026-01-01').getTime();
  endTs   = endTs   || Date.now();
  const trades = [];

  try {
    if(exchange==='binance') {
      // Futures closed trades
      const ts  = Date.now();
      const q   = `startTime=${startTs}&endTime=${endTs}&limit=1000&timestamp=${ts}`;
      const sig = await hmacSHA256(keys.secret, q);
      const r   = await (window.proxyFetch||fetch)(
        `https://fapi.binance.com/fapi/v1/userTrades?${q}&signature=${sig}`,
        { headers:{'X-MBX-APIKEY':keys.key} }
      );
      const d = await r.json();
      if(Array.isArray(d)) {
        const byOrder = {};
        d.forEach(t=>{
          if(!byOrder[t.orderId]) byOrder[t.orderId]={
            trades:[],symbol:t.symbol,side:t.side,
            realizedPnl:0,commission:0,qty:0,time:t.time
          };
          byOrder[t.orderId].trades.push(t);
          byOrder[t.orderId].realizedPnl += parseFloat(t.realizedPnl);
          byOrder[t.orderId].commission  += parseFloat(t.commission);
          byOrder[t.orderId].qty         += parseFloat(t.qty);
        });
        Object.values(byOrder).filter(o=>o.realizedPnl!==0).forEach(o=>{
          const pnl  = Math.round(o.realizedPnl*100)/100;
          const fees = Math.round(o.commission*100)/100;
          trades.push({
            exchangeSource:'BINANCE', exchangeId:`bnb-${o.trades[0].orderId}`,
            ticker:o.symbol.replace('USDT',''), dir:o.side==='BUY'?'long':'short',
            exchange:'BINANCE', type:'futures',
            entry:parseFloat(o.trades[0]?.price)||0,
            closePrice:parseFloat(o.trades[o.trades.length-1]?.price)||0,
            pnl:pnl-fees, pnlRaw:pnl, fees,
            posSize:o.qty*parseFloat(o.trades[0]?.price||0),
            status:'closed',
            createdAt:new Date(o.time).toISOString(),
            closeDate:new Date(o.time).toISOString().split('T')[0],
            closeNotes:`Importado de Binance Futures`,
          });
        });
      }
    }

    if(exchange==='bybit') {
      const ts  = Date.now().toString();
      const q   = `category=linear&startTime=${startTs}&endTime=${endTs}&limit=100`;
      const msg = ts+keys.key+'5000'+q;
      const sig = await hmacSHA256(keys.secret, msg);
      const r   = await (window.proxyFetch||fetch)(
        `https://api.bybit.com/v5/execution/list?${q}`,
        { headers:{'X-BAPI-API-KEY':keys.key,'X-BAPI-TIMESTAMP':ts,'X-BAPI-SIGN':sig,'X-BAPI-RECV-WINDOW':'5000'} }
      );
      const txt = await r.text();
      let d; try{d=JSON.parse(txt);}catch(e){return trades;}
      if(d.retCode===0&&d.result?.list) {
        const byOrder = {};
        d.result.list.forEach(t=>{
          if(!byOrder[t.orderId]) byOrder[t.orderId]={
            trades:[],symbol:t.symbol,side:t.side,pnl:0,fee:0,time:parseInt(t.execTime)
          };
          byOrder[t.orderId].trades.push(t);
          byOrder[t.orderId].pnl += parseFloat(t.closedPnl||0);
          byOrder[t.orderId].fee += parseFloat(t.execFee||0);
        });
        Object.values(byOrder).filter(o=>o.pnl!==0).forEach(o=>{
          const pnl  = Math.round(o.pnl*100)/100;
          const fees = Math.round(o.fee*100)/100;
          trades.push({
            exchangeSource:'BYBIT', exchangeId:`bybit-${o.trades[0].orderId}`,
            ticker:o.symbol.replace('USDT',''), dir:o.side==='Buy'?'long':'short',
            exchange:'BYBIT', type:'futures',
            entry:parseFloat(o.trades[0]?.execPrice)||0,
            closePrice:parseFloat(o.trades[o.trades.length-1]?.execPrice)||0,
            pnl:pnl-fees, pnlRaw:pnl, fees,
            posSize:parseFloat(o.trades[0]?.execValue)||0,
            status:'closed',
            createdAt:new Date(o.time).toISOString(),
            closeDate:new Date(o.time).toISOString().split('T')[0],
            closeNotes:'Importado de Bybit',
          });
        });
      }
    }

    if(exchange==='mexc') {
      // MEXC futures history
      const ts  = Date.now().toString();
      const q   = `start_time=${Math.floor(startTs/1000)}&end_time=${Math.floor(endTs/1000)}&page_size=100`;
      const toSign = keys.key + ts + q;
      // MEXC uses different auth: sign = HMAC(secret, apiKey+ts+queryString)
      const sig = await hmacSHA256(keys.secret, toSign);
      const r   = await (window.proxyFetch||fetch)(
        `https://contract.mexc.com/api/v1/private/order/history/new?${q}`,
        { headers:{
          'ApiKey':keys.key,
          'Request-Time':ts,
          'Signature':sig,
          'Content-Type':'application/json'
        }}
      );
      const txt = await r.text();
      let d; try{d=JSON.parse(txt);}catch(e){return trades;}
      if(d.success&&d.data?.resultList) {
        d.data.resultList.forEach(o=>{
          if(o.state!==3) return; // 3 = filled
          const pnl = parseFloat(o.realizedPnl||0);
          trades.push({
            exchangeSource:'MEXC', exchangeId:`mexc-${o.orderId}`,
            ticker:o.symbol.replace('_USDT','').replace('USDT',''),
            dir:o.side===1?'long':'short',
            exchange:'MEXC', type:'futures',
            entry:parseFloat(o.openAvgPrice)||0,
            closePrice:parseFloat(o.closeAvgPrice)||0,
            pnl, pnlRaw:pnl, fees:0,
            posSize:parseFloat(o.vol)*parseFloat(o.openAvgPrice||1),
            status:'closed',
            createdAt:new Date(o.createTime).toISOString(),
            closeDate:new Date(o.updateTime||o.createTime).toISOString().split('T')[0],
            closeNotes:'Importado de MEXC',
          });
        });
      }
    }
  } catch(e){ console.error(`fetchExchangeHistory ${exchange}:`, e); }
  return trades;
}

// ── Init ───────────────────────────────────────────────────────────────────
buildLevGrid();
installGlobalTooltips();
loadUserPrefs();
document.getElementById('dashDate').textContent = new Date().toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
