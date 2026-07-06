// ── Dashboard ──────────────────────────────────────────────────────────────
let chPnl, chWR, chA;
let _liquidityCache = null; // cache so we don't re-fetch on every render
let _liquidityLastFetchAt = 0;
const LIQUIDITY_CACHE_KEY = 'mauex_liquidity_cache_v1';
const LIQUIDITY_FETCH_BLOCK_KEY = 'mauex_liquidity_fetch_block_until';
const LIQUIDITY_FETCH_BLOCK_MS = 5 * 60 * 1000;
const LIQUIDITY_REFRESH_MIN_MS = 30 * 1000;

function saveLiquidityLocalCache(data) {
  if (!data?.balances || !Object.keys(data.balances).length) return;
  try {
    localStorage.setItem(LIQUIDITY_CACHE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      data,
    }));
  } catch(e) {}
}

function loadLiquidityLocalCache() {
  try {
    const raw = localStorage.getItem(LIQUIDITY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data ? { ...parsed.data, cacheSavedAt: parsed.savedAt || parsed.data.cacheSavedAt } : null;
  } catch(e) {
    return null;
  }
}

function liquidityFetchBlockedMessage() {
  const until = Number(localStorage.getItem(LIQUIDITY_FETCH_BLOCK_KEY) || 0) || 0;
  if (!until || Date.now() >= until) return '';
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return `Cloudflare rate limit activo. Reintento automatico en ${mins} min.`;
}

function blockLiquidityFetch() {
  try {
    localStorage.setItem(LIQUIDITY_FETCH_BLOCK_KEY, String(Date.now() + LIQUIDITY_FETCH_BLOCK_MS));
  } catch(e) {}
}

function liquidityFetchErrorMessage(e) {
  const msg = String(e?.message || e || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'Cloudflare esta devolviendo rate limit sin CORS. Espera el cooldown del Worker y evita refrescar/sincronizar en loop.';
  }
  return msg || 'No pude conectar con el Worker.';
}

function normalizeDashboardBalance(raw = {}) {
  const usdt = Number(raw.USDT ?? raw.usdt ?? 0) || 0;
  const usdc = Number(raw.USDC ?? raw.usdc ?? 0) || 0;
  const fallbackTotal = usdt + usdc;
  const total = Number(raw.total ?? raw.totalEquity ?? raw.wallet ?? fallbackTotal) || 0;
  const free = Number(raw.free ?? raw.displayFree ?? raw.available ?? raw.availableBalance ?? (fallbackTotal || total)) || 0;
  const margin = Number(raw.margin ?? raw.marginUsed ?? 0) || 0;
  const orders = Number(raw.orders ?? raw.orderMargin ?? 0) || 0;
  const pnl = Number(raw.pnl ?? raw.unrealizedPnl ?? raw.upnl ?? 0) || 0;

  return { total, free, margin, orders, pnl, USDT: usdt, USDC: usdc };
}

function dashboardTradeCapital(t) {
  const size = Number(t?.posSize ?? t?.totalSize ?? t?.size ?? 0) || 0;
  const lev = Math.max(1, Number(t?.leverage) || 1);
  const margin = Number(t?.margin ?? t?.orderMargin ?? t?.initialMargin ?? t?.positionIM ?? 0) || 0;
  if (String(t?.dir || '').toLowerCase() === 'spot') return size || margin;
  if (margin > 0) return margin;
  return size / lev;
}

function manualExchangeCapitalOverlay(data={}) {
  const out = {};
  const trades = window.G?.trades?.() || [];
  const addRow = (ex, status, capital) => {
    ex = String(ex || 'MANUAL').toUpperCase();
    if (!ex || ex === 'MANUAL' || !Number.isFinite(capital) || capital <= 0) return;
    if (!out[ex]) out[ex] = { margin: 0, orders: 0 };
    if (status === 'active' || status === 'zombie') out[ex].margin += capital;
    if (status === 'pending' || status === 'watchlist') out[ex].orders += capital;
  };
  trades.forEach(t => {
    addRow(t.exchange, t.status, dashboardTradeCapital(t));
  });
  const livePositions = Array.isArray(data.positions) ? data.positions : (window.exchangePositions || []);
  const liveOrders = Array.isArray(data.orders) ? data.orders : (window.exchangeOrders || []);
  livePositions.forEach(p => addRow(p.exchange, 'active', dashboardTradeCapital(p)));
  liveOrders.forEach(o => addRow(o.exchange, 'pending', dashboardTradeCapital(o)));
  return out;
}

function applyManualCapitalOverlay(data) {
  if (!data) return data;
  const manual = manualExchangeCapitalOverlay(data);
  const sourceBalances = data.balances || {};
  const balanceErrors = data.errors || data.balanceErrors || {};
  const balances = {};

  Object.entries(sourceBalances).forEach(([ex, raw]) => {
    const b = normalizeDashboardBalance(raw);
    const m = manual[ex] || { margin: 0, orders: 0 };
    let margin = Math.max(b.margin || 0, m.margin || 0);
    let orders = Math.max(b.orders || 0, m.orders || 0);
    const total = Math.max(b.total || 0, (b.free || 0) + margin + orders);
    balances[ex] = {
      ...b,
      total: Math.round(total * 100) / 100,
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

function normalizeDashboardLiquidityData(data) {
  if (!data) return data;
  const errors = data.errors || data.balanceErrors || {};
  return {
    ...data,
    balances: data.balances || {},
    errors,
    balanceErrors: errors,
    liquidity: data.liquidity || data.totals || {},
    totals: data.totals || data.liquidity || {},
  };
}

async function fetchAndRenderLiquidity(opts = {}) {
  const el = document.getElementById('dashLiquidity');
  if (!el) return;

  const forceRefresh = opts === true || opts?.force === true || opts?.forceRefresh === true;
  let fetchError = '';
  let data = normalizeDashboardLiquidityData(_liquidityCache || loadLiquidityLocalCache());
  if (data && !_liquidityCache) {
    _liquidityCache = data;
    window._liquidityCache = data;
  }

  fetchError = liquidityFetchBlockedMessage();

  const shouldRefresh = PROXY_URL && !fetchError && (forceRefresh || !data || Date.now() - _liquidityLastFetchAt > LIQUIDITY_REFRESH_MIN_MS);
  if (shouldRefresh) {
    try {
      _liquidityLastFetchAt = Date.now();
      if (!data) el.style.display = 'block';
      if (!data) {
        el.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--t3);font-family:var(--mono);font-size:11px;">Cargando capital...</div>`;
      }
      const r = await window.workerFetch(`/balance?live=1&t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        data = normalizeDashboardLiquidityData({ ...d, liquiditySource: 'balance' });
        _liquidityCache = data;
        window._liquidityCache = data;
        saveLiquidityLocalCache(data);
        if (window._drawCapitalPie) setTimeout(window._drawCapitalPie, 50);
      } else {
        const body = await r.text().catch(() => '');
        if (r.status === 429 || body.includes('1027')) blockLiquidityFetch();
        fetchError = body.includes('1027')
          ? 'Cloudflare Worker rate limited: Error 1027. Espera a que termine el cooldown del plan.'
          : r.status === 429
            ? 'Cloudflare Worker rate limited: HTTP 429. Espera unos minutos antes de reintentar.'
            : `Worker HTTP ${r.status}`;
      }
    } catch(e) {
      blockLiquidityFetch();
      fetchError = liquidityFetchErrorMessage(e);
    }
  }

  if (!data?.balances || Object.keys(data.balances).length === 0) {
    const balanceErrors = data?.errors || data?.balanceErrors || {};
    if (Object.keys(balanceErrors).length) {
      el.style.display = 'block';
      el.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--red);font-family:var(--mono);font-size:11px;">
        No pude leer capital de exchanges: ${Object.entries(balanceErrors).map(([ex,msg])=>`${ex}: ${msg}`).join(' | ')}
      </div>`;
      return;
    }
    el.style.display = 'block';
    el.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--red);font-family:var(--mono);font-size:11px;">
      No pude cargar Capital en exchanges${fetchError ? ': ' + dashSafe(fetchError) : '.'}
    </div>`;
    return;
  }

  window.syncApiModalStatus?.();

  const balances = Object.fromEntries(
    Object.entries(data.balances).map(([ex, b]) => {
      const normalized = normalizeDashboardBalance(b);
      if (b?.error) normalized.error = String(b.error);
      return [ex, normalized];
    })
  );
  Object.entries(data.errors || data.balanceErrors || {}).forEach(([ex, msg]) => {
    const key = String(ex || '').toUpperCase();
    if (!key || !msg) return;
    if (!balances[key]) {
      balances[key] = { total: 0, free: 0, margin: 0, orders: 0, pnl: 0, USDT: 0, USDC: 0 };
    }
    balances[key].error = String(msg);
  });

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
    if (total === 0 && !b.error) return '';
    const errorLine = b.error
      ? `<div style="font-size:8px;color:var(--red);font-family:var(--mono);margin-top:2px;">${dashSafe(b.error)}</div>`
      : '';

    const pnlStr = pnl !== 0
      ? `<span style="color:${pnl>=0?'var(--accent)':'var(--red)'};">${pnl>=0?'+':''}$${fmt(pnl)}</span>`
      : '<span style="color:var(--t3);">—</span>';

    return `<div style="display:grid;grid-template-columns:80px 1fr 1fr 1fr 1fr 90px;gap:4px;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border);">
      <span style="font-size:10px;font-weight:600;color:var(--t1);font-family:var(--mono);">${ex}${errorLine}</span>
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
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--t1);">${total>0?'$'+fmt(total):'-'}</div>
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
window._updateLiquidityCache = (data, opts = {}) => {
  if (opts?.source === 'summary') {
    fetchAndRenderLiquidity();
    return;
  }
  if (data) {
    const normalized = normalizeDashboardLiquidityData(data);
    _liquidityCache = normalized;
    window._liquidityCache = normalized;
    saveLiquidityLocalCache(normalized);
    if (window._drawCapitalPie) setTimeout(window._drawCapitalPie, 50);
    window.syncApiModalStatus?.();
    updateCalcExchangeCapitalButtons?.(calcRequiredMarginEstimate?.() || 0);
  }
  fetchAndRenderLiquidity();
};

window.refreshDashboardLiquidity = () => fetchAndRenderLiquidity({ forceRefresh: true });

const dashSafe = v => esc(v);
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
  const dashHistMetrics = document.getElementById('dashHistMetrics');
  if (dashHistMetrics) dashHistMetrics.innerHTML=[
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

  // Capital uses fetchAndRenderLiquidity so the dashboard does not mix stale /summary data with live /balance data.
  if (!_liquidityCache && PROXY_URL) fetchAndRenderLiquidity({ forceRefresh: true });

  // Active positions mini-list with live PnL total
  let liveTot=0, hasPx=false;
  active.forEach(t=>{ const p=G.getTradePrice?.(t) ?? G.getPrice(t.ticker,t.dir); if(p==null) return; hasPx=true; liveTot+=Math.round((t.posSize/t.entry)*(t.entry-p)*(t.dir==='short'?1:-1)*100)/100; });
  const liveRisk = active.reduce((s,t)=>s+openRiskOf(t),0);
  const posHtml = active.length ? `
    ${hasPx?`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0 10px;border-bottom:1px solid var(--border);margin-bottom:4px;">
      <span style="font-size:9px;color:var(--t3);font-family:var(--mono);">PNL TOTAL EN VIVO</span>
      <span style="font-family:var(--mono);font-size:14px;font-weight:600;" class="${liveTot>=0?'pnl-pos':'pnl-neg'}">${liveTot>=0?'+':'-'}$${fmt(Math.abs(liveTot))}</span>
      <span style="font-size:9px;color:var(--t3);font-family:var(--mono);margin-left:12px;">RIESGO</span>
      <span style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--red);">$${fmt(liveRisk)}</span>
    </div>`:''}
    ${active.slice(0,5).map(t=>{
    const p = G.getTradePrice?.(t) ?? G.getPrice(t.ticker, t.dir);
    const pnl = p!=null ? Math.round((t.posSize/t.entry)*(t.entry-p)*(t.dir==='short'?1:-1)*100)/100 : null;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--border);">
      <div class="fx" style="gap:6px;"><span style="font-family:var(--mono);font-weight:600;font-size:12px;">${dashSafe(t.ticker)}</span> <span class="badge ${t.dir==='long'?'bl':t.dir==='short'?'bs':'bsp'}">${t.dir.toUpperCase()}${(t.leverage||1)>1?' x'+(t.leverage||1):''}</span></div>
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
