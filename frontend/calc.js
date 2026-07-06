// ── Calc state ─────────────────────────────────────────────────────────────
const calcState = { dir:'short', ex:'binance', lev:null, marketSource:'auto', marketType:'', marketKind:'' };
let calcChartState = { tf:'1h', chart:null, resize:null, timer:null, key:'', signalTime:0, guideRemove:null };
let calcSignalTargetsState = null;
let calcTpPercentsManual = false;
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
  const manual = !!raw && (typed || (explicitManual && !coreChanged) || !coreChanged);
  const estimate = estimatedLiquidationPrice(nextInput);
  if (manual && Number.isFinite(parsed) && parsed > 0) {
    return { liquidation: parsed, liquidationManual: typed || explicitManual };
  }
  return { liquidation: estimate || null, liquidationManual: false };
}

function refreshEditLiquidationEstimate() {
  const el = document.getElementById('eLiquidation');
  if (!el || el.disabled || el.dataset.userEdited === '1') return;
  const entry = parseFloat(document.getElementById('eEntry')?.value) || 0;
  const lev = parseFloat(document.getElementById('eLev')?.value) || 1;
  const exchange = (document.getElementById('eExchange')?.value || '').trim();
  const estimate = estimatedLiquidationPrice({ dir: editDir, entry, leverage: lev, exchange });
  el.value = estimate || '';
  el.dataset.manualLiquidation = '0';
}

function calcChartLevelsFromInputs() {
  const entry = parseFloat(document.getElementById('cEntry')?.value) || 0;
  const sl = parseFloat(document.getElementById('cSL')?.value) || 0;
  const tp1 = parseFloat(document.getElementById('cTP1')?.value) || 0;
  const tp2 = parseFloat(document.getElementById('cTP2')?.value) || 0;
  const tp3 = parseFloat(document.getElementById('cTP3')?.value) || 0;
  const invs = readInvalidationFields('c');
  const liq = calcState.dir !== 'spot'
    ? estimatedLiquidationPrice({ dir:calcState.dir, entry, leverage:calcState.lev || 1, exchange:calcState.ex })
    : null;
  return [
    ...(entry ? [{ price:entry, title:'Entry', color:'rgba(232,237,243,.95)' }] : []),
    ...(sl ? [{ price:sl, title:'SL', color:'rgba(240,61,61,.95)' }] : []),
    ...(tp1 ? [{ price:tp1, title:'TP1', color:'rgba(0,196,122,.75)' }] : []),
    ...(tp2 ? [{ price:tp2, title:'TP2', color:'rgba(0,196,122,.88)' }] : []),
    ...(tp3 ? [{ price:tp3, title:'TP3', color:'rgba(0,196,122,1)' }] : []),
    ...invs.map((x,i) => ({ price:x.price, title:x.label || `Inv ${i+1}`, color:'rgba(56,189,248,.95)' })),
    ...(liq ? [{ price:liq, title:'Liq', color:'rgba(245,158,11,.95)' }] : []),
  ];
}

function chartSymbolForExchange(raw, source, marketKind='futures') {
  const clean = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_.\-=]/g,'');
  if (!clean) return '';
  const base = clean
    .replace(/[-_]?USDTM$/,'')
    .replace(/[-_]?USDT[-_]?SWAP$/,'')
    .replace(/[-_]?USDT$/,'')
    .replace(/USDT$/,'');
  if (source === 'okx') return clean.includes('-') ? clean : `${base}-USDT${marketKind === 'futures' ? '-SWAP' : ''}`;
  if (source === 'kucoin') {
    const kuBase = base === 'BTC' ? 'XBT' : base;
    if (clean.includes('-')) return clean;
    if (clean.endsWith('USDTM')) return clean.replace(/^BTC/, 'XBT');
    return marketKind === 'futures' ? `${kuBase}USDTM` : `${base}-USDT`;
  }
  if (source === 'mexc') return clean.includes('_') || clean.endsWith('USDT') ? clean : `${base}${marketKind === 'futures' ? '_USDT' : 'USDT'}`;
  if (source === 'bybit' || source === 'binance') return clean.endsWith('USDT') ? clean : `${base}USDT`;
  return clean;
}

function calcChartSymbolInfo() {
  const raw = (document.getElementById('cTicker')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9_.\-=]/g,'');
  if (!raw) return null;
  const exchange = calcState.ex || 'binance';
  const selectedSource = calcState.marketSource === 'auto'
    ? (calcState.ex || 'binance')
    : (calcState.marketSource || 'auto');
  const selectedType = calcState.marketType || '';
  const selectedKind = calcState.marketKind || (calcState.dir === 'spot' ? 'spot' : 'futures');
  if (selectedSource === 'yahoo') {
    return { raw, symbol: raw, source:'yahoo', type: selectedType || 'stock', marketKind:'spot' };
  }
  if (cryptoExchangeSource(selectedSource)) {
    return {
      raw,
      symbol: chartSymbolForExchange(raw, selectedSource, selectedKind),
      source: selectedSource,
      type: selectedType || 'crypto',
      marketKind: selectedKind,
    };
  }
  const crypto = selectedSource === 'binance' ? true : appIsCryptoTicker(raw, exchange);
  const symbol = crypto
    ? (raw.endsWith('USDT') || raw.endsWith('USDC') || raw.includes('_') ? raw.replace(/USDC$/,'USDT') : raw + 'USDT')
    : raw;
  return { raw, symbol, source: crypto ? 'binance' : 'yahoo', type: selectedType || (crypto ? 'crypto' : 'stock'), marketKind: crypto ? selectedKind : 'spot' };
}

function clearCalcSignalChart() {
  if (calcChartState.guideRemove) { try { calcChartState.guideRemove(); } catch(e) {} calcChartState.guideRemove = null; }
  if (calcChartState.resize) { try { calcChartState.resize.disconnect(); } catch(e) {} calcChartState.resize = null; }
  if (calcChartState.chart) { try { calcChartState.chart.remove(); } catch(e) {} calcChartState.chart = null; }
  const el = document.getElementById('calcSignalChart');
  if (el) el.innerHTML = '';
}

function scheduleCalcSignalChart() {
  clearTimeout(calcChartState.timer);
  calcChartState.timer = setTimeout(renderCalcSignalChart, 450);
}

window.setCalcChartTimeframe = (tf) => {
  calcChartState.tf = tf;
  document.querySelectorAll('[data-calc-tf]').forEach(b => b.classList.toggle('active', b.dataset.calcTf === tf));
  calcChartState.key = '';
  renderCalcSignalChart();
};

async function renderCalcSignalChart() {
  const el = document.getElementById('calcSignalChart');
  const status = document.getElementById('calcChartStatus');
  if (!el) return;
  const info = calcChartSymbolInfo();
  const entry = parseFloat(document.getElementById('cEntry')?.value) || 0;
  const retainedSignalTime = syncCalcChartSignalTime();
  if (!info || !entry) {
    clearCalcSignalChart();
    if (status) status.textContent = 'Carga ticker y entry para ver la señal.';
    return;
  }
  const key = [
    info.symbol, info.source, info.marketKind || '', calcState.dir, calcState.ex, calcState.lev || 1, calcChartState.tf,
    retainedSignalTime || 0,
    ['cEntry','cSL','cTP1','cTP2','cTP3','cInv1','cInv2'].map(id => document.getElementById(id)?.value || '').join('|')
  ].join('::');
  if (key === calcChartState.key && calcChartState.chart) return;
  calcChartState.key = key;
  clearCalcSignalChart();
  if (status) status.textContent = `Validando ${info.raw} en ${mainChartLabel(calcChartState.tf)}...`;
  el.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--t3);font-family:var(--mono);font-size:11px;">Cargando velas...</div>`;
  const prevSource = window._aiSource;
  const prevType = window._aiType;
  const prevMarketType = aiMarketType;
  try {
    window._aiSource = info.source;
    window._aiType = info.type;
    if (info.type === 'crypto') aiMarketType = info.marketKind || (calcState.dir === 'spot' ? 'spot' : 'futures');
    const candles = await fetchOHLCV(info.symbol, calcChartState.tf, mainChartLimit(calcChartState.tf));
    if (!candles.length) throw new Error('Sin datos');
    el.innerHTML = '';
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth || 720,
      height: el.clientHeight || 320,
      layout:{ background:{color:'transparent'}, textColor:'#8ea0b5' },
      localization:{ priceFormatter: mauexChartPriceFormatter },
      grid:{ vertLines:{color:'rgba(255,255,255,0.035)'}, horzLines:{color:'rgba(255,255,255,0.035)'} },
      crosshair:{ mode:1 },
      rightPriceScale:{ borderColor:'rgba(255,255,255,0.10)', scaleMargins:{top:0.06,bottom:0.20} },
      timeScale:{ borderColor:'rgba(255,255,255,0.10)', timeVisible:true, secondsVisible:false },
      handleScroll:{ mouseWheel:true, pressedMouseMove:true, horzTouchDrag:true, vertTouchDrag:true },
      handleScale:{ axisPressedMouseMove:true, mouseWheel:true, pinch:true },
    });
    calcChartState.chart = chart;
    const series = chart.addCandlestickSeries({
      upColor:'#00c47a', downColor:'#f03d3d',
      borderUpColor:'#00c47a', borderDownColor:'#f03d3d',
      wickUpColor:'#00a85a', wickDownColor:'#c03030',
      priceFormat: mauexPriceSeriesFormat(),
    });
    series.setData(candles);
    const vol = chart.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'volume', priceLineVisible:false, lastValueVisible:false });
    vol.setData(candles.map(c => ({ time:c.time, value:c.volume, color:c.close>=c.open?'rgba(0,196,122,.23)':'rgba(240,61,61,.23)' })));
    chart.priceScale('volume').applyOptions({ scaleMargins:{top:0.82,bottom:0} });
    const firstTime = candles[0]?.time;
    const lastTime = candles[candles.length - 1]?.time;
    calcChartLevelsFromInputs().forEach(lvl => {
      try {
        addHorizontalLevel(chart, lvl.price, firstTime, lastTime, { color:lvl.color, lineStyle:2 });
        series.createPriceLine({
          price:lvl.price,
          color:lvl.color,
          lineWidth:1,
          lineStyle:2,
          axisLabelVisible:true,
          title:lvl.title,
        });
      } catch(e) {}
    });
    chart.timeScale().fitContent();
    const calcGuideTime = nearestCandleTimeForGuide(candles, retainedSignalTime || 0);
    calcChartState.guideRemove = addChartTimeGuide(el, chart, calcGuideTime, 'Señal');
    el.ondblclick = () => chart.timeScale().fitContent();
    calcChartState.resize = new ResizeObserver(() => chart.applyOptions({ width:el.clientWidth, height:el.clientHeight || 320 }));
    calcChartState.resize.observe(el);
    const last = candles[candles.length - 1]?.close;
    const gap = last && entry ? ((last - entry) / entry * 100) : null;
    if (status) status.textContent = gap == null
      ? `${info.raw} · ${mainChartLabel(calcChartState.tf)}`
      : `${info.raw} · precio ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}% vs entry`;
  } catch(e) {
    if (status) status.textContent = `No pude cargar ${info.raw}: ${e.message}`;
    el.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--red);font-family:var(--mono);font-size:11px;">${esc(e.message)}</div>`;
  } finally {
    window._aiSource = prevSource;
    window._aiType = prevType;
    aiMarketType = prevMarketType;
  }
}

window.openCalcSetupInCharts = () => {
  const info = calcChartSymbolInfo();
  if (!info) { toast('Carga un ticker primero.', 'error'); return; }
  const el = document.getElementById('aiSymbol');
  if (el) el.value = info.symbol;
  window._aiSource = info.source;
  window._aiType = info.type;
  mainChartState.symbol = info.symbol;
  if (info.type === 'crypto') setMarketType(info.marketKind || (calcState.dir === 'spot' ? 'spot' : 'futures'));
  _analysisTradeData = {
    ticker: info.raw,
    dir: calcState.dir,
    exchange: (calcState.ex || '').toUpperCase(),
    marketSource: info.source,
    marketType: info.type,
    marketKind: info.marketKind || (calcState.dir === 'spot' ? 'spot' : 'futures'),
    leverage: calcState.lev || 1,
    entry: parseFloat(document.getElementById('cEntry')?.value) || 0,
    sl: parseFloat(document.getElementById('cSL')?.value) || 0,
    tp1: parseFloat(document.getElementById('cTP1')?.value) || 0,
    tp2: parseFloat(document.getElementById('cTP2')?.value) || 0,
    tp3: parseFloat(document.getElementById('cTP3')?.value) || 0,
    signalTime: window._signalTradeExtras?.signalTime || (calcChartState.signalTime ? new Date(calcChartState.signalTime * 1000).toISOString() : ''),
  };
  showPage('analysis');
  showChartsTab('graficos');
  loadCharts();
};
const LEVS = [1.5,2,3,5,7,10,15,20,25,50];

window.setDir = d => {
  calcState.dir = d;
  document.querySelectorAll('[data-d]').forEach(b => {
    b.className = 'dir-btn';
    if (b.dataset.d===d) b.classList.add(d==='long'?'al':d==='short'?'as':'asp');
  });
  const sp = d==='spot';
  document.getElementById('exchSec').style.display = 'block';
  document.getElementById('levSec').style.display  = sp?'none':'block';
  document.getElementById('spotNote').style.display = sp?'block':'none';
  document.getElementById('mmrLabel').textContent = sp
    ? `${String(calcState.ex || '').toUpperCase()} spot - capital libre`
    : MMR_LBL[calcState.ex];
  calcSyncTickerSourceToExchange();
  compute();
};

window.setEx = ex => {
  calcState.ex = ex;
  document.querySelectorAll('[data-ex]').forEach(b => b.classList.toggle('active', b.dataset.ex===ex));
  document.getElementById('mmrLabel').textContent = calcState.dir === 'spot'
    ? `${String(ex || '').toUpperCase()} spot - capital libre`
    : MMR_LBL[ex];
  calcSyncTickerSourceToExchange();
  compute();
};

function legacyCalcTickerSourceLabel() {
  const source = calcState.marketSource || 'auto';
  const type = calcState.marketType || '';
  if (source === 'binance') return `Fuente: Binance ${type ? '· ' + type.toUpperCase() : ''}`;
  if (source === 'yahoo') return `Fuente: Yahoo ${type ? '· ' + type.toUpperCase() : ''}`;
  if (source === 'mexc') return `Fuente: MEXC ${type ? '· ' + type.toUpperCase() : ''}`;
  return 'Fuente: Auto';
}

function updateCalcTickerSourceBadge() {
  const el = document.getElementById('calcTickerSourceBadge');
  if (el) el.textContent = calcTickerSourceLabel();
}

function legacySetCalcTickerSource(source='auto', type='') {
  calcState.marketSource = source || 'auto';
  calcState.marketType = source === 'auto' ? '' : (type || '');
  calcChartState.key = '';
  updateCalcTickerSourceBadge();
}

window.handleCalcTickerInput = val => {
  const el = document.getElementById('cTicker');
  if (el) el.value = String(val || '').toUpperCase();
  setCalcTickerSource('auto', '');
  window.showCalcTickerSuggestions?.(el?.value || val || '');
  compute();
};

window.legacySelectCalcTicker = (ticker, source, type) => {
  const el = document.getElementById('cTicker');
  if (el) el.value = String(ticker || '').toUpperCase();
  const dd = document.getElementById('calcTickerDD');
  if (dd) dd.style.display = 'none';
  setCalcTickerSource(source || 'auto', type || '');
  compute();
};

window.legacyCurrentCalcTickerMarket = () => ({
  source: calcState.marketSource || 'auto',
  type: calcState.marketType || '',
});

function cryptoExchangeSource(source='') {
  return ['binance','bybit','okx','mexc','kucoin'].includes(String(source || '').toLowerCase());
}

function calcTickerSourceLabel() {
  const source = calcState.marketSource || 'auto';
  const type = calcState.marketType || '';
  const kind = calcState.marketKind || '';
  const suffix = [type ? type.toUpperCase() : '', kind ? kind.toUpperCase() : ''].filter(Boolean).join(' - ');
  const names = { binance:'Binance', bybit:'Bybit', okx:'OKX', mexc:'MEXC', kucoin:'KuCoin', yahoo:'Yahoo' };
  return source === 'auto' ? 'Fuente: Auto' : `Fuente: ${names[source] || source.toUpperCase()}${suffix ? ' - ' + suffix : ''}`;
}

function setCalcTickerSource(source='auto', type='', marketKind='') {
  calcState.marketSource = source || 'auto';
  calcState.marketType = source === 'auto' ? '' : (type || '');
  calcState.marketKind = source === 'auto' ? '' : (marketKind || '');
  calcChartState.key = '';
  updateCalcTickerSourceBadge();
}

function calcSyncTickerSourceToExchange() {
  const source = calcState.marketSource || 'auto';
  if (calcState.dir === 'spot') {
    if (source === 'auto' || cryptoExchangeSource(source)) {
      setCalcTickerSource(calcState.ex || 'binance', 'crypto', 'spot');
    }
    return;
  }
  if (source === 'auto' || cryptoExchangeSource(source)) {
    setCalcTickerSource(calcState.ex || 'binance', 'crypto', 'futures');
  }
}

window.selectCalcTicker = (ticker, source, type, marketKind='') => {
  const el = document.getElementById('cTicker');
  if (el) el.value = String(ticker || '').toUpperCase();
  const dd = document.getElementById('calcTickerDD');
  if (dd) dd.style.display = 'none';
  const kind = marketKind || (source === 'yahoo' ? 'spot' : (calcState.dir === 'spot' ? 'spot' : 'futures'));
  if (source === 'yahoo') {
    if (calcState.dir !== 'spot') setDir('spot');
  } else if (cryptoExchangeSource(source)) {
    if (kind === 'spot' && calcState.dir !== 'spot') setDir('spot');
    if (kind === 'futures' && calcState.dir === 'spot') setDir('long');
    if (source !== calcState.ex) setEx(source);
  }
  setCalcTickerSource(source || 'auto', type || '', kind);
  compute();
};

window.currentCalcTickerMarket = () => ({
  source: calcState.marketSource || 'auto',
  type: calcState.marketType || '',
  kind: calcState.marketKind || '',
});

function calcTpPercentIds() {
  return ['cTP1pct','cTP2pct','cTP3pct'];
}

function setCalcTpPercentsManual(manual) {
  calcTpPercentsManual = !!manual;
  calcTpPercentIds().forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.manualPct = calcTpPercentsManual ? '1' : '0';
  });
}

function calcHasManualTpPercentValues() {
  return calcTpPercentIds().some(id => (document.getElementById(id)?.value || '').trim() !== '');
}

window.handleCalcTpPriceInput = () => {
  if (!calcTpPercentsManual) syncCalcTpPercents({ force:true });
  compute();
};

window.handleCalcTpPercentInput = () => {
  setCalcTpPercentsManual(calcHasManualTpPercentValues());
  if (!calcTpPercentsManual) syncCalcTpPercents({ force:true });
  compute();
};

function calcTpPercentValue(id, fallback) {
  const el = document.getElementById(id);
  const raw = (el?.value || '').trim();
  if (raw === '') return calcTpPercentsManual ? 0 : fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : (calcTpPercentsManual ? 0 : fallback);
}

function syncCalcTpPercents(opts={}) {
  if (calcTpPercentsManual && !opts.force) return;
  const tpIds = ['cTP1','cTP2','cTP3'];
  const pctIds = calcTpPercentIds();
  const active = tpIds.map(id => {
    const el = document.getElementById(id);
    return !!(parseFloat(el?.value) > 0);
  });
  const count = active.filter(Boolean).length;
  const dist = count === 1 ? [100,0,0] : count === 2 ? [50,50,0] : count >= 3 ? [33,33,34] : [0,0,0];
  let used = 0;
  pctIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!active[i]) {
      el.value = '';
      return;
    }
    el.value = dist[used++] || '';
  });
}
window.syncCalcTpPercents = syncCalcTpPercents;

function setCalcTpFieldsFromSelection() {
  if (!calcSignalTargetsState) return;
  const targets = calcSignalTargetsState.targets || [];
  const selected = (calcSignalTargetsState.selectedIndexes || [])
    .map(Number)
    .filter(i => Number.isInteger(i) && i >= 0 && i < targets.length)
    .slice(0, 3);
  const values = selected.map(i => targets[i]).filter(Boolean);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('cTP1', values[0] || '');
  set('cTP2', values[1] || '');
  set('cTP3', values[2] || '');
  if (!calcTpPercentsManual) {
    const pcts = signalOperationalPercents(values.length);
    set('cTP1pct', pcts[0] || '');
    set('cTP2pct', pcts[1] || '');
    set('cTP3pct', pcts[2] || '');
  }
  if (window._signalTradeExtras) {
    window._signalTradeExtras.selectedTargets = values;
    window._signalTradeExtras.selectedTargetIndexes = selected;
  }
}

function renderCalcSignalTargets() {
  const panel = document.getElementById('calcSignalTargetsPanel');
  if (!panel) return;
  if (!calcSignalTargetsState || !calcSignalTargetsState.targets?.length) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  const targets = calcSignalTargetsState.targets;
  const selected = new Set(calcSignalTargetsState.selectedIndexes || []);
  const parsed = {
    dir: calcState.dir,
    entry: parseFloat(document.getElementById('cEntry')?.value) || calcSignalTargetsState.entry || 0,
    sl: parseFloat(document.getElementById('cSL')?.value) || calcSignalTargetsState.sl || 0,
    leverage: calcState.lev || calcSignalTargetsState.leverage || 1,
  };
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="calc-signal-targets-head">
      <div>
        <div class="calc-signal-targets-title">TP disponibles de la señal</div>
        <div class="calc-signal-targets-sub">Elegí hasta 3 para calcular el trade.</div>
      </div>
      <div class="calc-signal-targets-sub">${selected.size}/3 seleccionados</div>
    </div>
    <div class="calc-signal-targets-grid">
      ${targets.map((price, i) => {
        const m = signalTargetMeta(parsed, price);
        const extra = m.pnlText ? ` - ${m.pnlText}` : '';
        return `<button type="button" class="calc-signal-target-pill ${selected.has(i) ? 'selected' : ''}" onclick="toggleCalcSignalTarget(${i})" title="TP${i + 1}: ${m.rrText} - ${m.moveText}${extra}">
          <span>${selected.has(i) ? 'OK ' : ''}TP${i + 1} - ${m.rrText}</span>
          <strong>$${fmtPx(price)}</strong>
          <small>${m.moveText}${extra}</small>
        </button>`;
      }).join('')}
    </div>`;
}

window.toggleCalcSignalTarget = index => {
  if (!calcSignalTargetsState) return;
  const targets = calcSignalTargetsState.targets || [];
  if (!targets[index]) return;
  let selected = (calcSignalTargetsState.selectedIndexes || [])
    .map(Number)
    .filter(i => Number.isInteger(i) && i >= 0 && i < targets.length);
  if (selected.includes(index)) {
    selected = selected.filter(i => i !== index);
  } else {
    if (selected.length >= 3) {
      toast('Máximo 3 TP para calcular el trade.', 'error');
      return;
    }
    selected.push(index);
  }
  calcSignalTargetsState.selectedIndexes = [...new Set(selected)].sort((a,b) => a - b);
  setCalcTpFieldsFromSelection();
  renderCalcSignalTargets();
  compute();
};

window.currentCalcSignalSelection = () => {
  const values = ['cTP1','cTP2','cTP3']
    .map(id => parseFloat(document.getElementById(id)?.value) || 0)
    .filter(Boolean);
  if (!calcSignalTargetsState) return { selectedTargets: values, selectedTargetIndexes: [] };
  const targets = calcSignalTargetsState.targets || [];
  const indexes = values
    .map(v => targets.findIndex(t => Math.abs(Number(t) - v) / Math.max(1e-9, Math.abs(Number(v))) < 0.000001))
    .filter(i => i >= 0);
  return { selectedTargets: values, selectedTargetIndexes: indexes };
};

window.clearCalcSignalTargets = () => {
  calcSignalTargetsState = null;
  renderCalcSignalTargets();
};

function calcRequiredMarginEstimate() {
  const entry = parseFloat(document.getElementById('cEntry')?.value) || 0;
  const sl = parseFloat(document.getElementById('cSL')?.value) || 0;
  const risk = parseFloat(document.getElementById('cRisk')?.value) || 0;
  const sizeManual = parseFloat(document.getElementById('cSize')?.value) || 0;
  const lev = Math.max(1, Number(calcState.lev) || 1);
  if (sizeManual > 0) return calcState.dir === 'spot' ? sizeManual : sizeManual / lev;
  if (!risk) return 0;
  if (calcState.dir === 'spot') return risk;
  if (!entry || !sl) return risk;
  const slDist = Math.abs(sl - entry) / entry;
  if (!slDist) return risk;
  return (risk / slDist) / lev;
}

function updateCalcExchangeCapitalButtons(requiredMargin=0) {
  const balances = window._liquidityCache?.balances || {};
  document.querySelectorAll('[data-calc-ex]').forEach(btn => {
    const ex = btn.dataset.calcEx;
    const small = btn.querySelector('small');
    const free = Number(balances?.[ex]?.free);
    btn.classList.remove('cap-ok','cap-warn','cap-bad');
    if (!small) return;
    if (!Number.isFinite(free)) {
      small.textContent = '—';
      return;
    }
    small.textContent = '$' + fmt(free);
    if (requiredMargin > 0) {
      btn.classList.add(free >= requiredMargin ? 'cap-ok' : free >= requiredMargin * .65 ? 'cap-warn' : 'cap-bad');
    } else if (free > 0) {
      btn.classList.add('cap-ok');
    }
  });
}

function buildLevGrid() {
  const g = document.getElementById('levGrid');
  g.innerHTML = LEVS.map(l=>`
    <div class="lev-btn ${l===calcState.lev?'sel':''}" onclick="pickLev(${l})">${l}x</div>
  `).join('');
}

window.syncCalcLeveragePlacement = () => {
  const lev = document.getElementById('levSec');
  const mobileSlot = document.getElementById('mobileLevSlot');
  const exchange = document.getElementById('exchSec');
  if (!lev || !mobileSlot || !exchange) return;
  const mobile = window.matchMedia?.('(max-width: 768px)').matches || window.innerWidth <= 768;
  if (mobile) {
    if (lev.parentElement !== mobileSlot) mobileSlot.appendChild(lev);
    return;
  }
  const home = exchange.parentElement;
  if (home && lev.parentElement !== home) exchange.insertAdjacentElement('afterend', lev);
};

window.addEventListener('resize', () => window.syncCalcLeveragePlacement?.());
setTimeout(() => window.syncCalcLeveragePlacement?.(), 0);

window.pickLev = l => {
  calcState.lev = l;
  document.getElementById('levCustom').value = '';
  buildLevGrid();
  compute();
};

window.setCustomLev = v => {
  const n = parseFloat(v);
  if (n>=1&&n<=125) {
    calcState.lev = Math.round(n * 100) / 100;
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
  refreshEditLiquidationEstimate();
};

window.compute = () => {
  renderRiskSuggestionPanel();
  syncCalcTpPercents();
  const entry = parseFloat(document.getElementById('cEntry').value)||0;
  const sl    = parseFloat(document.getElementById('cSL').value)||0;
  const risk  = parseFloat(document.getElementById('cRisk').value)||0;
  const tp1   = parseFloat(document.getElementById('cTP1').value)||0;
  const tp2   = parseFloat(document.getElementById('cTP2').value)||0;
  const tp3   = parseFloat(document.getElementById('cTP3').value)||0;
  const calcInvs = readInvalidationFields('c');
  const tp1pct= calcTpPercentValue('cTP1pct', 33)/100;
  const tp2pct= calcTpPercentValue('cTP2pct', 33)/100;
  const tp3pct= calcTpPercentValue('cTP3pct', 34)/100;

  if (!entry) {
    updateCalcExchangeCapitalButtons(calcRequiredMarginEstimate());
    renderCalcSignalTargets();
    ['calcMetrics','calcLevels','calcBar'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.innerHTML='';
    });
    scheduleCalcSignalChart();
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
  updateCalcExchangeCapitalButtons(margin || calcRequiredMarginEstimate());
  const liq     = !sp ? estimatedLiquidationPrice({ dir:calcState.dir, entry, leverage:lev, exchange:calcState.ex }) : null;
  const liqSafe = !liq || !hasSL || (sh?liq>sl:liq<sl);
  const liqLoss = !sp && liq && margin ? Math.round(Math.abs(margin) * 100) / 100 : null;
  renderCalcSignalTargets();

  // Alerts
  const a1=document.getElementById('calcAlert1'),a2=document.getElementById('calcAlert2');
  const warns=[];
  if(hasSL && sh&&sl<=entry) warns.push('SL debe ser MAYOR al Entry para SHORT');
  if(hasSL && !sh&&!sp&&sl>=entry) warns.push('SL debe ser MENOR al Entry para LONG');
  if(hasSL && !liqSafe) warns.push('🔴 Liquidación más cercana que el SL — reducí el apalancamiento');
  const danger=warns.filter(w=>w.includes('🔴')), other=warns.filter(w=>!w.includes('🔴'));
  a1.style.display=danger.length?'block':'none'; a1.textContent=danger.join(' · ');
  a2.style.display=other.length?'block':'none';  a2.textContent=other.join(' · ');

  // Metrics
  const riskPrice = hasSL ? sl : (!sp && liq ? liq : 0);
  const riskDist = riskPrice ? Math.abs(riskPrice-entry)/entry : 0;
  const rrParts = [[tp1,tp1pct],[tp2,tp2pct],[tp3,tp3pct]]
    .filter(([price,pct]) => riskDist && price > 0 && pct > 0)
    .map(([price,pct]) => ({ rr: Math.abs((price-entry)/(riskPrice-entry)), pct }));
  const rrWeight = rrParts.reduce((s,r) => s + r.pct, 0);
  const weightedRR = rrWeight ? rrParts.reduce((s,r) => s + r.rr * r.pct, 0) / rrWeight : null;
  const marginRiskPct = hasSL ? slDist*(sp?1:lev)*100 : (!sp && liqLoss ? 100 : null);
  const metricRows = [
    {l:'Tamaño posición',v:'$'+fmt(posSize||0)},
    {l:sp?'Capital':'Margen isolated',v:'$'+fmt(margin||0)},
    ...(marginRiskPct!=null?[{l:hasSL?'SL % margen':'Liq % margen',v:marginRiskPct.toFixed(1)+'%',cls:marginRiskPct>50?'red':''}]:[]),
    ...(weightedRR!=null?[{l:'R:R ponderado',v:weightedRR.toFixed(2)+':1',cls:weightedRR>=2?'green':weightedRR>=1?'':'red'}]:[]),
    ...(!sp&&liq?[{l:'Liquidación',v:'$'+fmtPx(liq),cls:liqSafe?'':'red'}]:[]),
    ...(!hasSL&&!sp&&liqLoss!=null?[{l:'Pérdida en liq.',v:'-$'+fmt(liqLoss),cls:'red'}]:[]),
  ];

  document.getElementById('calcMetrics').innerHTML= metricRows
    .map(m=>`<div class="metric"><div class="metric-lbl">${m.l}</div><div class="metric-val ${m.cls||''}">${m.v}</div></div>`)
    .join('');

  // Levels table
  const sign = sh ? -1 : 1;
  const pnlAtTP = (tpPrice, pct) => posSize ? Math.round((tpPrice-entry)/entry * posSize * pct * sign * 100)/100 : null;
  let cumPnl = 0;
  const tpRows = [];
  if(tp1){ const p=pnlAtTP(tp1,tp1pct); if(p!=null) cumPnl+=p; tpRows.push({l:'TP1',price:tp1,pnl:p,cum:p!=null?cumPnl:null,rr:riskPrice?Math.abs((tp1-entry)/(riskPrice-entry)):null,pct:tp1pct}); }
  if(tp2){ const p=pnlAtTP(tp2,tp2pct); if(p!=null) cumPnl+=p; tpRows.push({l:'TP2',price:tp2,pnl:p,cum:p!=null?cumPnl:null,rr:riskPrice?Math.abs((tp2-entry)/(riskPrice-entry)):null,pct:tp2pct}); }
  if(tp3){ const p=pnlAtTP(tp3,tp3pct); if(p!=null) cumPnl+=p; tpRows.push({l:'TP3',price:tp3,pnl:p,cum:p!=null?cumPnl:null,rr:riskPrice?Math.abs((tp3-entry)/(riskPrice-entry)):null,pct:tp3pct}); }

  const levelRows = [
    {l:'Entry',price:entry,pnl:null,cum:null,rr:null,pct:null,isEntry:true},
    ...tpRows,
    ...(hasSL?[{l:'SL',price:sl,pnl:hasRisk?-risk:null,cum:hasRisk?-risk:null,rr:null,pct:null,isSL:true}]:[]),
    ...(!sp&&liq?[{l:'LIQ',price:liq,pnl:liqLoss!=null?-liqLoss:null,cum:liqLoss!=null?-liqLoss:null,rr:null,pct:null,isLiq:true}]:[]),
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
  const pts=[{v:entry,l:'Entry',c:'var(--t1)'},...(hasSL?[{v:sl,l:'SL',c:'var(--red)'}]:[]),
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
    ${hasSL?`<div style="position:absolute;left:${pct(Math.min(entry,sl))}%;width:${Math.abs(pct(sl)-pct(entry))}%;height:6px;background:var(--red);opacity:.5;border-radius:3px;top:0;"></div>`:''}
    ${!hasSL&&liq?`<div style="position:absolute;left:${pct(Math.min(entry,liq))}%;width:${Math.abs(pct(liq)-pct(entry))}%;height:6px;background:var(--amber);opacity:.5;border-radius:3px;top:0;"></div>`:''}
    ${tpZones.map(z=>`<div style="position:absolute;left:${pct(Math.min(entry,z.to))}%;width:${Math.abs(pct(z.to)-pct(z.from))}%;height:6px;background:var(--accent);opacity:${z.op};border-radius:3px;top:0;"></div>`).join('')}
    ${pts.map(p=>`
      <div style="position:absolute;left:${pct(p.v)}%;transform:translateX(-50%);top:-20px;text-align:center;">
        <div style="font-size:8px;color:${p.c};font-family:var(--mono);font-weight:600;white-space:nowrap;">${p.l}</div>
        <div style="width:1.5px;height:20px;background:${p.c};margin:1px auto;"></div>
      </div>
      <div style="position:absolute;left:${pct(p.v)}%;transform:translateX(-50%);top:10px;font-size:8px;color:${p.c};font-family:var(--mono);white-space:nowrap;">$${fmtPx(p.v)}</div>`).join('')}`;
  scheduleCalcSignalChart();
};
