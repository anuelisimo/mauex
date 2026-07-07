// ── Proxy config ──────────────────────────────────────────────────────────
// Set this to your Cloudflare Worker URL after deploying worker.js
// Example: 'https://mauex-proxy.tuusuario.workers.dev'
// ── Helpers ────────────────────────────────────────────────────────────────
const fmt  = (n,d=0) => isNaN(n)?'—':n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
}
window.esc = esc;
function jsArg(value) {
  return JSON.stringify(String(value ?? '')).replace(/[<>&]/g, ch => ({
    '<':'\\u003C', '>':'\\u003E', '&':'\\u0026'
  })[ch]);
}
window.jsArg = jsArg;
const SCRIPT_LOADS = {};
function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  if (!SCRIPT_LOADS[src]) {
    SCRIPT_LOADS[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No pude cargar ${src}`));
      document.head.appendChild(script);
    });
  }
  return SCRIPT_LOADS[src];
}
async function ensureLightweightCharts() {
  if (window.LightweightCharts?.createChart) return window.LightweightCharts;
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js');
  if (!window.LightweightCharts?.createChart) throw new Error('LightweightCharts no esta disponible');
  return window.LightweightCharts;
}
window.ensureLightweightCharts = ensureLightweightCharts;
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
  'HYPE','CAKE','LINEA','XVG','POL','TAO','VIRTUAL','ASTER','JUP','SUI','IDOL','PTB','WLD'];
const APP_CRYPTO_EXCHANGES = ['BINANCE','BYBIT','OKX','MEXC','KUCOIN','GATE','KRAKEN','COINBASE','HUOBI'];
function appIsCryptoTicker(ticker, exchange) {
  const ex = String(exchange || '').toUpperCase();
  if (['YAHOO','IBKR'].includes(ex)) return false;
  const raw = String(ticker || '').trim().toUpperCase();
  if (/[.=^]/.test(raw) && !/USDT$|BUSD$/.test(raw)) return false;
  if (window.isCryptoTicker) return window.isCryptoTicker(ticker, exchange);
  if (APP_CRYPTO_EXCHANGES.includes(ex)) return true;
  const sym = raw.replace(/USDT|BUSD|USD$/,'');
  return APP_CRYPTOS.includes(sym) || raw.endsWith('USDT') || raw.endsWith('BUSD');
}
const YAHOO_PRICE_CACHE_MS = 45000;
const yahooPriceCache = window.__mauexYahooPriceCache || (window.__mauexYahooPriceCache = new Map());

async function mauexFetchYahooPrice(ticker, options = {}) {
  const sym = String(ticker || '').trim().toUpperCase();
  if (!sym) return 0;
  const now = Date.now();
  const cached = yahooPriceCache.get(sym);
  if (!options.force && cached && now - cached.ts < YAHOO_PRICE_CACHE_MS) return cached.price;
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`,
  ];
  let d = null;
  let lastError = null;
  for (const url of urls) {
    const fetchers = [
      ...(window.proxyFetch ? [() => window.proxyFetch(url, { cache:'no-store' })] : []),
      () => fetch(url, { cache:'no-store' }),
    ];
    for (const run of fetchers) {
      try {
        const r = await run();
        if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
        d = await r.json();
        if (d?.chart?.result?.[0]) break;
      } catch(e) {
        lastError = e;
      }
    }
    if (d?.chart?.result?.[0]) break;
  }
  if (!d) throw lastError || new Error('Yahoo sin datos');
  const res = d.chart?.result?.[0];
  const quote = res?.indicators?.quote?.[0]?.close || [];
  const lastClose = quote.filter(x => Number.isFinite(Number(x))).map(Number).pop();
  const price = Number(res?.meta?.regularMarketPrice || lastClose || res?.meta?.previousClose || 0);
  if (price > 0) yahooPriceCache.set(sym, { price, ts: Date.now() });
  return price;
}
window.mauexFetchYahooPrice = mauexFetchYahooPrice;

async function fetchYahooSpotPrice(ticker) {
  return mauexFetchYahooPrice(ticker);
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
function formatLevValue(value) {
  const n = Number(value || 1);
  if (!Number.isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
function dirLevLabel(item) {
  const dir = String(item?.dir || '').toUpperCase();
  const lev = Number(item?.leverage || item?.lev || 1);
  if (!dir) return '—';
  if (dir === 'SPOT' || !Number.isFinite(lev) || lev <= 1) return dir;
  return dir + ' x' + formatLevValue(lev);
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
        <span style="font-size:16px;font-weight:600;">${esc(order.ticker||order.symbol||'—')}</span>
        <span class="badge ${dirCls}">${dir.toUpperCase()}${lev}</span>
        <span style="font-size:11px;color:var(--t3);">${esc(order.exchange||'')}</span>
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
