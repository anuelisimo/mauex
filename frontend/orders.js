// ── Orders rendering ─────────────────────────────────────────────────────────
let exchangeOrders = [];
window.exchangeOrders = window.exchangeOrders || exchangeOrders;
let orderSyncError = '';

function orderNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeExchangeOpenOrder(o = {}) {
  const exchange = String(o.exchange || o.exchangeSource || 'EXCHANGE').toUpperCase();
  const rawTicker = String(o.ticker || o.symbol || o.instId || '?').trim();
  const ticker = rawTicker
    .replace(/[-_]?USDTM$/i, '')
    .replace(/[-_]?USDT[-_]?SWAP$/i, '')
    .replace(/[-_]?USDT$/i, '')
    .replace(/USDT|BUSD|USD$/i, '')
    .toUpperCase() || rawTicker.toUpperCase();
  const entry = orderNum(o.entry ?? o.price ?? o.orderPrice ?? o.triggerPrice ?? o.stopPrice);
  const qty = orderNum(o.qty ?? o.quantity ?? o.origQty ?? o.sizeBase);
  const totalSize = orderNum(o.totalSize ?? o.size ?? o.notional ?? o.orderValue, qty && entry ? qty * entry : 0);
  const side = String(o.dir || o.side || '').toLowerCase();
  const dir = side.includes('sell') || side === 'short' ? 'short' : side.includes('spot') ? 'spot' : 'long';
  const exchangeId = String(o.exchangeId || o.orderId || o.id || `${exchange}-${rawTicker}-${entry}-${totalSize}`).trim();
  return {
    ...o,
    _exchange: true,
    exchange,
    ticker,
    entry,
    price: entry,
    totalSize,
    size: totalSize,
    dir,
    type: o.type || o.orderType || 'LIMIT',
    status: o.status || 'ABIERTA',
    exchangeId,
    id: exchangeId,
  };
}

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

  const canUseWorkerOrders = !!(PROXY_URL && window.getWorkerApiToken?.());
  const canUseLocalOrders = !!(_masterPass && window.G?._hasExchangeKeys?.());
  const liveOrders = (window.exchangeOrders || exchangeOrders || [])
    .map(normalizeExchangeOpenOrder)
    .filter(o => o.exchangeId && (o.entry > 0 || o.totalSize > 0));
  const manualIds = new Set(manualOrders.map(o => String(o.exchangeId || o.id || '')));
  const allOrders = [
    ...manualOrders,
    ...liveOrders.filter(o => !manualIds.has(String(o.exchangeId || o.id || ''))),
  ];

  if(!allOrders.length && !canUseWorkerOrders && !canUseLocalOrders) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">◇</div>
      <div class="empty-text">Conecta tus exchanges o configura MAUEX_API_TOKEN para ver ordenes</div>
      <button class="btn acc sm" style="margin-top:12px;" onclick="window.showPage('settings')">⚙ Configurar</button>
    </div>`;
    return;
  }

  if(!allOrders.length) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">◇</div>
      <div class="empty-text">No hay ordenes pendientes</div>
      <div class="empty-sub">${orderSyncError ? 'Ultimo sync: ' + esc(orderSyncError) : 'Usa la calculadora para enviar ordenes aqui'}</div>
    </div>`;
    return;
  }

  // Sort by distance to entry (closest = executes soonest = first)
  const sortedOrders = [...allOrders].sort((a, b) => {
    const G = window.G;
    const symA = a.ticker?.replace(/[-_]?USDTM$/,'').replace(/[-_]?USDT[-_]?SWAP$/,'').replace(/[-_]?USDT$/,'').replace(/USDT|BUSD$/,'').toUpperCase() || a.ticker;
    const symB = b.ticker?.replace(/[-_]?USDTM$/,'').replace(/[-_]?USDT[-_]?SWAP$/,'').replace(/[-_]?USDT$/,'').replace(/USDT|BUSD$/,'').toUpperCase() || b.ticker;
    const pA = G?.getTradePrice?.(a) || G?.getPrice(symA, a.dir) || G?.getPrice(symA+'USDT', a.dir) || 0;
    const pB = G?.getTradePrice?.(b) || G?.getPrice(symB, b.dir) || G?.getPrice(symB+'USDT', b.dir) || 0;
    const eA = a.entry || a.price || 0;
    const eB = b.entry || b.price || 0;
    const dA = pA&&eA ? Math.abs(pA-eA)/pA : Infinity;
    const dB = pB&&eB ? Math.abs(pB-eB)/pB : Infinity;
    return dA - dB;
  });

  const cardStates = getCardState();

  container.innerHTML = sortedOrders.map(o=>{
    const G = window.G;
    const sym = o.ticker?.replace(/[-_]?USDTM$/,'').replace(/[-_]?USDT[-_]?SWAP$/,'').replace(/[-_]?USDT$/,'').replace(/USDT|BUSD$/,'').toUpperCase() || o.ticker;
    const currentPrice = G?.getTradePrice?.(o) || G?.getPrice(sym, o.dir) || G?.getPrice(sym+'USDT', o.dir) || G?.getPrice(o.symbol?.replace(/USDT$/,''), o.dir) || 0;
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
            <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--t1);">${dashSafe(o.ticker)}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${dirBg};color:${dirColor};font-family:var(--mono);border:0.5px solid ${dirBorder};">${dirLevLabel(o)}</span>
            <a href="${getExchangeUrl(o.exchange, o.ticker, o.dir)||'#'}" target="_blank" rel="noopener"
              style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2);text-decoration:none;">${dashSafe(o.exchange)} ↗</a>
            <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--amber-dim);color:var(--amber);font-family:var(--mono);">PENDIENTE</span>
            ${o.traderName?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);">· ${dashSafe(o.traderName)}</span>`:''}
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
      <div style="display:grid;grid-template-columns:2fr repeat(4,1fr);gap:8px;padding:10px 14px;background:rgba(0,0,0,0.15);">
        <select onchange="window.moveCardToStatus('${o.id}', this.value)"
          style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;">
          <option value="watchlist">👁 Watchlist</option>
          <option value="pending" selected>⏳ Órdenes</option>
          <option value="active">🟢 Posición</option>
        </select>
        ${chartsIconButton(o.id)}
        ${calculatorIconButton(o.id)}
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
    const now = new Date().toISOString();
    const current = (window.G?.trades?.() || []).find(t => t.id === id);
    await updateDoc(doc(db,'trades',id), {
      status: newStatus,
      updatedAt: now,
      ...(newStatus === 'active' && !current?.executedAt ? { executedAt: now } : {}),
    });
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
  orderSyncError = '';
  try {
    if(PROXY_URL) {
      const r = await window.workerFetch(`/orders?live=1&t=${Date.now()}`, { cache:'no-store' });
      const text = await r.text();
      let d = {};
      try { d = text ? JSON.parse(text) : {}; } catch(e) {}
      if (!r.ok) throw new Error(d.error || `Worker /orders HTTP ${r.status}`);
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
    orderSyncError = (typeof liquidityFetchErrorMessage === 'function' ? liquidityFetchErrorMessage(e) : '') || e.message || String(e);
    window.exchangeOrders = exchangeOrders;
    renderOrders();
    toast('Ordenes: ' + orderSyncError, 'error');
    if(btn){ btn.textContent='↻ Sync órdenes'; btn.disabled=false; }
  }
};

// ── Update fetchExchangeHistory to accept date range ──────────────────────────
// Wrap existing function with date params
const _origFetchHistory = typeof legacyFetchExchangeHistory !== 'undefined' ? legacyFetchExchangeHistory : null;
// Override to add MEXC support and date range
async function fetchExchangeHistory(exchange, keys, startTs, endTs) {
  startTs = startTs || new Date('2026-01-01').getTime();
  endTs   = endTs   || Date.now();
  const trades = [];

  try {
    if(exchange==='okx' && _origFetchHistory) {
      return await _origFetchHistory(exchange, keys);
    }

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
