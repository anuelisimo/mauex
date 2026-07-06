// ── AI Analysis ────────────────────────────────────────────────────────────
let lwCharts = {}; // lightweight chart instances

let aiMarketType = 'spot'; // 'spot' | 'futures'
let mainChartState = { symbol:'BTCUSDT', tf:'1d', log:false, smc:false, emaRibbon:false, chart:null, obvChart:null, resize:null, obvResize:null, smcOverlayResize:null, guideRemovers:[] };
let chartsLoading = false;

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
  if (document.getElementById('chartsTabGraficosContent')?.style.display !== 'none') {
    loadMainChart(mainChartState.symbol);
  } else if (!chartsLoading && document.getElementById('chartsTabAIContent')?.style.display !== 'none') {
    loadCharts();
  }
};

async function fetchExchangeOHLCV(source, symbol, interval, limit=300, marketKind='futures') {
  const fetchFn = window.publicFetch || fetch;
  if(source === 'bybit') {
    const bybitIv = {'1M':'M','1w':'W','1d':'D','4h':'240','1h':'60','30m':'30','15m':'15'}[interval] || '60';
    const category = marketKind === 'spot' ? 'spot' : 'linear';
    const bybitSymbol = chartSymbolForExchange(symbol, 'bybit', marketKind);
    const url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${encodeURIComponent(bybitSymbol)}&interval=${bybitIv}&limit=${Math.min(limit, 1000)}`;
    const r = await fetchFn(url);
    if(!r.ok) throw new Error(`Bybit HTTP ${r.status}`);
    const d = await r.json();
    const rows = Array.isArray(d?.result?.list) ? d.result.list : [];
    if (!rows.length) throw new Error('Bybit sin velas');
    return rows.slice().reverse().map(k=>({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5] || 0),
    })).filter(c=>c.open>0&&c.close>0);
  }
  if(source === 'okx') {
    const okxBar = {'1M':'1M','1w':'1W','1d':'1D','4h':'4H','1h':'1H','30m':'30m','15m':'15m'}[interval] || '1H';
    const instId = chartSymbolForExchange(symbol, 'okx', marketKind);
    const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${okxBar}&limit=${Math.min(limit, 300)}`;
    const r = await fetchFn(url);
    if(!r.ok) throw new Error(`OKX HTTP ${r.status}`);
    const d = await r.json();
    const rows = Array.isArray(d?.data) ? d.data : [];
    if (!rows.length) throw new Error('OKX sin velas');
    return rows.slice().reverse().map(k=>({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5] || 0),
    })).filter(c=>c.open>0&&c.close>0);
  }
  if(source === 'mexc') {
    const mexcSpotIv = {'1M':'1M','1w':'1W','1d':'1d','4h':'4h','1h':'60m','30m':'30m','15m':'15m'}[interval] || '60m';
    const mexcSpotSym = chartSymbolForExchange(symbol, 'mexc', 'spot');
    const url = `https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(mexcSpotSym)}&interval=${mexcSpotIv}&limit=${Math.min(limit, 1000)}`;
    const r = await fetchFn(url);
    if(!r.ok) throw new Error(`MEXC Spot HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) throw new Error('MEXC Spot sin velas');
    return data.map(k=>({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5] || 0),
    })).filter(c=>c.open>0&&c.close>0);
  }
  if(source === 'kucoin') {
    if (marketKind === 'spot') {
      const kucoinType = {'1M':'1month','1w':'1week','1d':'1day','4h':'4hour','1h':'1hour','30m':'30min','15m':'15min'}[interval] || '1hour';
      const kucoinSymbol = chartSymbolForExchange(symbol, 'kucoin', 'spot');
      const url = `https://api.kucoin.com/api/v1/market/candles?type=${kucoinType}&symbol=${encodeURIComponent(kucoinSymbol)}`;
      const r = await fetchFn(url);
      if(!r.ok) throw new Error(`KuCoin HTTP ${r.status}`);
      const d = await r.json();
      const rows = Array.isArray(d?.data) ? d.data : [];
      if (!rows.length) throw new Error('KuCoin sin velas');
      return rows.slice(0, limit).reverse().map(k=>({
        time: Number(k[0]),
        open: parseFloat(k[1]),
        close: parseFloat(k[2]),
        high: parseFloat(k[3]),
        low: parseFloat(k[4]),
        volume: parseFloat(k[5] || 0),
      })).filter(c=>c.open>0&&c.close>0);
    }
    const granularity = {'1M':1440,'1w':10080,'1d':1440,'4h':240,'1h':60,'30m':30,'15m':15}[interval] || 60;
    const kucoinSymbol = chartSymbolForExchange(symbol, 'kucoin', 'futures');
    const to = Math.floor(Date.now() / 1000);
    const from = to - granularity * 60 * Math.min(Math.max(limit, 50), 1500);
    const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${encodeURIComponent(kucoinSymbol)}&granularity=${granularity}&from=${from}&to=${to}`;
    const r = await fetchFn(url);
    if(!r.ok) throw new Error(`KuCoin Futures HTTP ${r.status}`);
    const d = await r.json();
    const rows = Array.isArray(d?.data) ? d.data : [];
    if (!rows.length) throw new Error('KuCoin Futures sin velas');
    return rows
    .slice()
    .sort((a,b) => Number(a[0]) - Number(b[0]))
    .slice(-limit)
    .map(k=>{
      const rawTime = Number(k[0]);
      return {
      time: rawTime > 1e10 ? Math.floor(rawTime / 1000) : Math.floor(rawTime),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5] || 0),
    };
    }).filter(c=>c.open>0&&c.close>0);
  }
  throw new Error('Exchange no soportado para velas');
}

async function fetchOHLCV(symbol, interval, limit=300) {
  const exchangeFetchSource = String(window._aiSource || '').toLowerCase();
  const exchangeFetchKind = aiMarketType === 'spot' ? 'spot' : 'futures';
  if (['bybit','okx','kucoin'].includes(exchangeFetchSource) || (exchangeFetchSource === 'mexc' && exchangeFetchKind === 'spot')) {
    return fetchExchangeOHLCV(exchangeFetchSource, symbol, interval, limit, exchangeFetchKind);
  }
  // MEXC commodities — use MEXC futures klines
  if(window._aiSource === 'mexc') {
    // symbol is already in MEXC format (e.g. GOLD_USDT) set by selectTicker
    const mexcSym = symbol;
    const ivMap = {'1M':'Month1','1w':'Week1','1d':'Day1','4h':'Hour4','1h':'Min60','30m':'Min30','15m':'Min15'};
    const mexcIv = ivMap[interval] || 'Day1';
    try {
      const url = `https://contract.mexc.com/api/v1/contract/kline/${mexcSym}?interval=${mexcIv}&limit=${limit}`;
      const r   = await (window.publicFetch ? window.publicFetch(url) : fetch(url));
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
    const ivMap = {'1M':'1mo','1w':'1wk','1d':'1d','4h':'1h','1h':'1h','30m':'30m','15m':'15m'};
    const rangeMap = {'1M':'10y','1w':'5y','1d':'1y','4h':'3mo','1h':'1mo','30m':'1mo','15m':'5d'};
    const yhIv = ivMap[interval]||'1d';
    const range = rangeMap[interval]||'1y';
    const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yhIv}&range=${range}`;
    try {
      const fetchers = [
        ...(window.proxyFetch ? [() => window.proxyFetch(yhUrl, { cache:'no-store' })] : []),
        ...(window.publicFetch ? [() => window.publicFetch(yhUrl, { cache:'no-store' })] : []),
        () => fetch(yhUrl, { cache:'no-store' }),
      ];
      let d = null;
      let lastError = null;
      for (const run of fetchers) {
        try {
          const r = await run();
          if(!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
          d = await r.json();
          break;
        } catch(err) {
          lastError = err;
        }
      }
      if (!d) throw lastError || new Error('Sin datos Yahoo');
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

  // Crypto: Binance. Try the preferred market first, then public-data fallbacks.
  const bases = aiMarketType === 'futures'
    ? [
        'https://fapi.binance.com/fapi/v1/klines',
        'https://data-api.binance.vision/api/v3/klines',
        'https://api.binance.com/api/v3/klines',
      ]
    : [
        'https://data-api.binance.vision/api/v3/klines',
        'https://api.binance.com/api/v3/klines',
      ];
  const fetchFn = window.publicFetch || fetch;
  let data = null;
  let lastErr = null;
  for (const base of bases) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const r = await fetchFn(url);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
      if (Array.isArray(data) && data.length) break;
      throw new Error('Sin velas');
    } catch(e) {
      lastErr = e;
      data = null;
    }
  }
  if (!data) {
    const baseAsset = String(symbol || '').replace(/USDT$|BUSD$|USD$/,'').toUpperCase();
    const okxBarMap = {'1M':'1M','1w':'1W','1d':'1D','4h':'4H','1h':'1H','30m':'30m','15m':'15m'};
    const okxBar = okxBarMap[interval] || '1H';
    const okxInstIds = aiMarketType === 'futures'
      ? [`${baseAsset}-USDT-SWAP`, `${baseAsset}-USDT`]
      : [`${baseAsset}-USDT`, `${baseAsset}-USDT-SWAP`];
    for (const instId of okxInstIds) {
      try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${okxBar}&limit=${Math.min(limit, 300)}`;
        const r = await fetchFn(url);
        if(!r.ok) throw new Error(`OKX HTTP ${r.status}`);
        const d = await r.json();
        const rows = Array.isArray(d?.data) ? d.data : [];
        if (!rows.length) throw new Error('OKX sin velas');
        return rows.slice().reverse().map(k=>({
          time:   Math.floor(Number(k[0]) / 1000),
          open:   parseFloat(k[1]),
          high:   parseFloat(k[2]),
          low:    parseFloat(k[3]),
          close:  parseFloat(k[4]),
          volume: parseFloat(k[5] || 0),
        })).filter(c=>c.open>0&&c.close>0);
      } catch(e) {
        lastErr = e;
      }
    }

    try {
      const yhIvMap = {'1M':'1mo','1w':'1wk','1d':'1d','4h':'1h','1h':'1h','30m':'30m','15m':'15m'};
      const yhRangeMap = {'1M':'10y','1w':'5y','1d':'1y','4h':'3mo','1h':'1mo','30m':'1mo','15m':'5d'};
      const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(baseAsset + '-USD')}?interval=${yhIvMap[interval]||'1d'}&range=${yhRangeMap[interval]||'1y'}`;
      const fetchers = [
        ...(window.proxyFetch ? [() => window.proxyFetch(yhUrl, { cache:'no-store' })] : []),
        ...(window.publicFetch ? [() => window.publicFetch(yhUrl, { cache:'no-store' })] : []),
        () => fetch(yhUrl, { cache:'no-store' }),
      ];
      let d = null;
      let yahooLastErr = null;
      for (const run of fetchers) {
        try {
          const r = await run();
          if(!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
          d = await r.json();
          break;
        } catch(err) {
          yahooLastErr = err;
        }
      }
      if (!d) throw yahooLastErr || new Error('Yahoo sin datos');
      const res = d.chart?.result?.[0];
      const ts = res?.timestamp || [];
      const q = res?.indicators?.quote?.[0] || {};
      const yahooCandles = ts.map((t,i)=>({
        time:t,
        open:Number(q.open?.[i] || 0),
        high:Number(q.high?.[i] || 0),
        low:Number(q.low?.[i] || 0),
        close:Number(q.close?.[i] || 0),
        volume:Number(q.volume?.[i] || 0),
      })).filter(c=>c.open>0&&c.close>0);
      if (yahooCandles.length) return yahooCandles;
      throw new Error('Yahoo sin velas');
    } catch(e) {
      lastErr = e;
    }
  }
  if (!data) throw new Error(lastErr?.message || 'No pude cargar velas');
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

function addSlopeColoredEma(chart, candles, period, lineWidth=2) {
  if (!chart || candles.length < period + 2) return;
  const ema = calcEMA(candles, period);
  let run = [];
  let runColor = null;
  const flush = () => {
    if (run.length < 2) return;
    const s = chart.addLineSeries({
      color: runColor,
      lineWidth,
      priceLineVisible:false,
      lastValueVisible:false,
      crosshairMarkerVisible:false,
      priceFormat: mauexPriceSeriesFormat(),
    });
    s.setData(run);
  };
  for (let i=1; i<ema.length; i++) {
    const color = ema[i].value >= ema[i-1].value ? '#0da578' : '#ed28a4';
    const point = { time:ema[i].time, value:ema[i].value };
    if (!runColor) {
      runColor = color;
      run = [{ time:ema[i-1].time, value:ema[i-1].value }, point];
    } else if (color === runColor) {
      run.push(point);
    } else {
      flush();
      runColor = color;
      run = [{ time:ema[i-1].time, value:ema[i-1].value }, point];
    }
  }
  flush();
}

function drawEmaRibbon(chart, candles) {
  [
    { period:9, width:2 },
    { period:21, width:2 },
    { period:50, width:2 },
    { period:100, width:2 },
    { period:200, width:2 },
  ].forEach(x => addSlopeColoredEma(chart, candles, x.period, x.width));
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
  new ResizeObserver(()=>ch.applyOptions({width:el.clientWidth, height:el.clientHeight || height})).observe(el);
  return ch;
}

function mainChartLimit(tf) {
  return tf === '15m' ? 500 : tf === '30m' ? 600 : tf === '1h' ? 600 : tf === '4h' ? 500 : tf === '1d' ? 700 : tf === '1w' ? 400 : 180;
}

function mainChartLabel(tf) {
  return ({'15m':'15m','30m':'30M','1h':'1H','4h':'4H','1d':'1D','1w':'1W','1M':'1M'})[tf] || tf;
}

function clearMainChart() {
  (mainChartState.guideRemovers || []).forEach(fn => { try { fn(); } catch(e) {} });
  mainChartState.guideRemovers = [];
  if (mainChartState.resize) { try { mainChartState.resize.disconnect(); } catch(e) {} mainChartState.resize = null; }
  if (mainChartState.obvResize) { try { mainChartState.obvResize.disconnect(); } catch(e) {} mainChartState.obvResize = null; }
  if (mainChartState.smcOverlayResize) { try { mainChartState.smcOverlayResize.disconnect(); } catch(e) {} mainChartState.smcOverlayResize = null; }
  if (mainChartState.chart) { try { mainChartState.chart.remove(); } catch(e) {} mainChartState.chart = null; }
  if (mainChartState.obvChart) { try { mainChartState.obvChart.remove(); } catch(e) {} mainChartState.obvChart = null; }
  const el = document.getElementById('mainChart');
  if (el) el.innerHTML = '';
  const obv = document.getElementById('mainObvChart');
  if (obv) obv.innerHTML = '';
}

window.showChartsTab = (tab) => {
  const isGraph = tab !== 'ai';
  const graph = document.getElementById('chartsTabGraficosContent');
  const ai = document.getElementById('chartsTabAIContent');
  const bGraph = document.getElementById('chartsTabGraficos');
  const bAI = document.getElementById('chartsTabAI');
  if (graph) graph.style.display = isGraph ? 'block' : 'none';
  if (ai) ai.style.display = isGraph ? 'none' : 'block';
  bGraph?.classList.toggle('active', isGraph);
  bAI?.classList.toggle('active', !isGraph);
  if (isGraph) setTimeout(() => loadMainChart(mainChartState.symbol), 50);
  else setTimeout(() => loadCharts(), 50);
};

window.setMainChartTimeframe = (tf) => {
  mainChartState.tf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
  loadMainChart(mainChartState.symbol);
};

window.toggleMainChartScale = () => {
  mainChartState.log = !mainChartState.log;
  const btn = document.getElementById('mainChartScaleBtn');
  if (btn) btn.textContent = mainChartState.log ? 'Lineal' : 'Log';
  loadMainChart(mainChartState.symbol);
};

window.toggleMainChartSmc = () => {
  mainChartState.smc = !mainChartState.smc;
  const btn = document.getElementById('mainChartSmcBtn');
  if (btn) btn.textContent = mainChartState.smc ? 'SMC on' : 'SMC off';
  loadMainChart(mainChartState.symbol);
};

window.toggleMainChartEmaRibbon = () => {
  mainChartState.emaRibbon = !mainChartState.emaRibbon;
  const btn = document.getElementById('mainChartEmaBtn');
  if (btn) btn.textContent = mainChartState.emaRibbon ? 'EMA on' : 'EMA off';
  loadMainChart(mainChartState.symbol);
};

window.fitMainChart = () => {
  try { mainChartState.chart?.timeScale().fitContent(); } catch(e) {}
};

window.toggleMainChartFullscreen = () => {
  const shell = document.getElementById('mainChartShell');
  if (!shell) return;
  shell.classList.toggle('fullscreen');
  setTimeout(() => {
    try {
      const el = document.getElementById('mainChart');
      mainChartState.chart?.applyOptions({ width: el?.clientWidth || 800, height: el?.clientHeight || 500 });
      const obv = document.getElementById('mainObvChart');
      mainChartState.obvChart?.applyOptions({ width: obv?.clientWidth || 800, height: obv?.clientHeight || 110 });
    } catch(e) {}
  }, 80);
};

function addHorizontalLevel(chart, level, from, to, opts={}) {
  if (!chart || !Number(level) || !from || !to) return null;
  const s = chart.addLineSeries({
    color: opts.color || 'rgba(232,237,243,.7)',
    lineWidth: opts.lineWidth || 1,
    lineStyle: opts.lineStyle ?? 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: mauexPriceSeriesFormat(),
  });
  s.setData([{ time: from, value: level }, { time: to, value: level }]);
  return s;
}

function calcAverageTrueRange(candles, period=50) {
  if (!candles?.length) return 0;
  const start = Math.max(1, candles.length - period);
  let sum = 0, count = 0;
  for (let i=start; i<candles.length; i++) {
    const prev = candles[i-1]?.close || candles[i].close;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prev),
      Math.abs(candles[i].low - prev)
    );
    if (Number.isFinite(tr)) { sum += tr; count++; }
  }
  return count ? sum / count : 0;
}

function findOrderBlockBefore(candles, event, direction) {
  const idx = candles.findIndex(c => c.time === event.time);
  if (idx < 2) return null;
  const min = Math.max(0, idx - 18);
  for (let i=idx-1; i>=min; i--) {
    const c = candles[i];
    const bearishCandle = c.close < c.open;
    const bullishCandle = c.close > c.open;
    if ((direction === 'bull' && bearishCandle) || (direction === 'bear' && bullishCandle)) {
      return {
        side: direction,
        time: c.time,
        top: Math.max(c.open, c.close, c.high),
        bottom: Math.min(c.open, c.close, c.low),
        mid: (Math.max(c.high, c.open, c.close) + Math.min(c.low, c.open, c.close)) / 2,
      };
    }
  }
  return null;
}

function detectFairValueGaps(candles, atr) {
  const gaps = [];
  const minGap = Math.max((atr || 0) * 0.12, 0);
  for (let i=2; i<candles.length; i++) {
    const a = candles[i-2];
    const c = candles[i];
    if (c.low > a.high && (c.low - a.high) >= minGap) {
      gaps.push({ side:'bull', time:c.time, top:c.low, bottom:a.high });
    }
    if (c.high < a.low && (a.low - c.high) >= minGap) {
      gaps.push({ side:'bear', time:c.time, top:a.low, bottom:c.high });
    }
  }
  return gaps;
}

function detectEqualHighLow(pivots, atr) {
  const threshold = Math.max((atr || 0) * 0.18, 0);
  if (!threshold) return [];
  const levels = [];
  ['high','low'].forEach(type => {
    const ps = pivots.filter(p => p.type === type);
    for (let i=1; i<ps.length; i++) {
      const a = ps[i-1], b = ps[i];
      if (Math.abs(a.level - b.level) <= threshold) {
        levels.push({
          type,
          time:b.time,
          from:a.time,
          level:(a.level + b.level) / 2,
        });
      }
    }
  });
  return levels;
}

function detectSmcEvents(candles, size=12) {
  const pivots = [];
  for (let i=size; i<candles.length-size; i++) {
    const slice = candles.slice(i-size, i+size+1);
    const maxH = Math.max(...slice.map(c=>c.high));
    const minL = Math.min(...slice.map(c=>c.low));
    if (candles[i].high >= maxH) pivots.push({ type:'high', level:candles[i].high, time:candles[i].time, crossed:false });
    if (candles[i].low <= minL) pivots.push({ type:'low', level:candles[i].low, time:candles[i].time, crossed:false });
  }
  const events = [];
  let lastHigh = null, lastLow = null, trend = 0;
  for (const c of candles) {
    pivots.filter(p => p.time < c.time && !p.seen).forEach(p => {
      p.seen = true;
      if (p.type === 'high') lastHigh = p;
      if (p.type === 'low') lastLow = p;
    });
    if (lastHigh && !lastHigh.crossed && c.close > lastHigh.level) {
      const tag = trend < 0 ? 'CHoCH' : 'BOS';
      events.push({ time:c.time, price:c.high, side:'bull', tag, level:lastHigh.level, pivotTime:lastHigh.time });
      lastHigh.crossed = true; trend = 1;
    }
    if (lastLow && !lastLow.crossed && c.close < lastLow.level) {
      const tag = trend > 0 ? 'CHoCH' : 'BOS';
      events.push({ time:c.time, price:c.low, side:'bear', tag, level:lastLow.level, pivotTime:lastLow.time });
      lastLow.crossed = true; trend = -1;
    }
  }
  const atr = calcAverageTrueRange(candles, 80);
  const orderBlocks = events
    .slice(-18)
    .map(e => findOrderBlockBefore(candles, e, e.side))
    .filter(Boolean);
  const fairValueGaps = detectFairValueGaps(candles, atr).slice(-16);
  const equalLevels = detectEqualHighLow(pivots.slice(-40), atr).slice(-10);
  return { events, pivots, orderBlocks, fairValueGaps, equalLevels, atr };
}

function smcCoord(chart, series, time, price) {
  const x = chart.timeScale().timeToCoordinate(time);
  const y = series.priceToCoordinate(price);
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function smcDrawLabel(ctx, text, x, y, color, align='center') {
  ctx.save();
  ctx.font = '10px "Fira Code", monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function smcDrawBox(ctx, chart, series, item, top, bottom, color, label, opts={}) {
  const from = smcCoord(chart, series, item.time, top);
  const yBottom = series.priceToCoordinate(bottom);
  if (!from || yBottom == null) return;
  const x1 = Math.max(0, from.x);
  const x2 = opts.toX ?? ctx.canvas.clientWidth;
  const y1 = Math.min(from.y, yBottom);
  const h = Math.max(3, Math.abs(yBottom - from.y));
  if (x2 <= x1 || !Number.isFinite(h)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x1, y1, x2 - x1, h);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, x2 - x1, h);
  }
  if (label) smcDrawLabel(ctx, label, x1 + 8, y1 + Math.min(14, h / 2), opts.labelColor || 'rgba(232,237,243,.75)', 'left');
  ctx.restore();
}

function drawMainSmcCanvasOverlay(chart, series, candles, smcData) {
  const el = document.getElementById('mainChart');
  if (!el || !chart || !series || !candles?.length || !smcData) return;
  let canvas = document.getElementById('mainSmcOverlay');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'mainSmcOverlay';
    canvas.className = 'main-smc-overlay';
    el.appendChild(canvas);
  }
  const draw = () => {
    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const rightX = rect.width;
    smcData.fairValueGaps.slice(-10).forEach(g => {
      smcDrawBox(ctx, chart, series, g, g.top, g.bottom,
        g.side === 'bull' ? 'rgba(32,72,145,.35)' : 'rgba(126,40,58,.35)',
        g.side === 'bull' ? 'Bull FVG' : 'Bear FVG',
        { toX:rightX, border:g.side === 'bull' ? 'rgba(49,121,245,.24)' : 'rgba(247,124,128,.24)' }
      );
    });

    smcData.orderBlocks.slice(-9).forEach(ob => {
      smcDrawBox(ctx, chart, series, ob, ob.top, ob.bottom,
        ob.side === 'bull' ? 'rgba(0,196,122,.22)' : 'rgba(240,61,61,.22)',
        ob.side === 'bull' ? 'Bull OB' : 'Bear OB',
        { toX:rightX, border:ob.side === 'bull' ? 'rgba(0,196,122,.55)' : 'rgba(240,61,61,.55)' }
      );
    });

    const swingHigh = [...smcData.pivots].reverse().find(p => p.type === 'high');
    const swingLow = [...smcData.pivots].reverse().find(p => p.type === 'low');
    if (swingHigh && swingLow && swingHigh.level !== swingLow.level) {
      const top = Math.max(swingHigh.level, swingLow.level);
      const bottom = Math.min(swingHigh.level, swingLow.level);
      const yTop = series.priceToCoordinate(top);
      const yBottom = series.priceToCoordinate(bottom);
      if (yTop != null && yBottom != null) {
        const yPremium = Math.min(yTop, yBottom);
        const yDiscount = Math.max(yTop, yBottom);
        const h = Math.abs(yBottom - yTop);
        const xStart = Math.max(0, Math.min(
          chart.timeScale().timeToCoordinate(swingHigh.time) ?? 0,
          chart.timeScale().timeToCoordinate(swingLow.time) ?? 0
        ));
        ctx.fillStyle = 'rgba(240,61,61,.20)';
        ctx.fillRect(xStart, yPremium, rightX - xStart, h * 0.25);
        ctx.fillStyle = 'rgba(135,139,148,.16)';
        ctx.fillRect(xStart, yPremium + h * 0.42, rightX - xStart, h * 0.16);
        ctx.fillStyle = 'rgba(0,196,122,.18)';
        ctx.fillRect(xStart, yPremium + h * 0.75, rightX - xStart, h * 0.25);
        smcDrawLabel(ctx, 'Premium', xStart + (rightX - xStart) / 2, yPremium + 12, '#f03d3d');
        smcDrawLabel(ctx, 'Equilibrium', rightX - 8, yPremium + h * 0.50, 'rgba(232,237,243,.68)', 'right');
        smcDrawLabel(ctx, 'Discount', xStart + (rightX - xStart) / 2, yPremium + h - 12, '#00c47a');
        smcDrawLabel(ctx, 'Strong High', rightX - 8, yPremium + 12, '#f03d3d', 'right');
        smcDrawLabel(ctx, 'Weak Low', rightX - 8, yPremium + h - 12, '#00c47a', 'right');
      }
    }

    smcData.events.slice(-35).forEach(e => {
      const p = smcCoord(chart, series, e.time, e.level);
      if (!p) return;
      ctx.save();
      ctx.strokeStyle = e.side === 'bull' ? 'rgba(0,196,122,.75)' : 'rgba(240,61,61,.75)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, p.x - 42), p.y);
      ctx.lineTo(Math.min(rightX, p.x + 42), p.y);
      ctx.stroke();
      smcDrawLabel(ctx, e.tag, p.x, p.y + (e.side === 'bull' ? -12 : 12), e.side === 'bull' ? '#00c47a' : '#f03d3d');
      ctx.restore();
    });

    smcData.equalLevels.forEach(eq => {
      const p = smcCoord(chart, series, eq.time, eq.level);
      if (!p) return;
      smcDrawLabel(ctx, eq.type === 'high' ? 'EQH' : 'EQL', p.x, p.y + (eq.type === 'high' ? -12 : 12), eq.type === 'high' ? '#f03d3d' : '#00c47a');
    });
  };
  draw();
  chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
  if (mainChartState.smcOverlayResize) { try { mainChartState.smcOverlayResize.disconnect(); } catch(e) {} }
  mainChartState.smcOverlayResize = new ResizeObserver(draw);
  mainChartState.smcOverlayResize.observe(el);
}

function drawSmcOverlay(chart, candleSeries, candles) {
  if (!chart || !candleSeries || !candles?.length) return;
  const from = candles[Math.max(0, candles.length - 180)]?.time || candles[0].time;
  const to = candles[candles.length - 1].time;
  const smcData = detectSmcEvents(candles, Math.max(5, mainChartState.tf === '1h' || mainChartState.tf === '30m' || mainChartState.tf === '15m' ? 8 : 12));
  const { events, pivots, orderBlocks, fairValueGaps, equalLevels } = smcData;
  const recentEvents = events.slice(-40);
  const markers = recentEvents.map(e => ({
    time:e.time,
    position:e.side === 'bull' ? 'belowBar' : 'aboveBar',
    color:e.side === 'bull' ? '#00c47a' : '#f03d3d',
    shape:e.side === 'bull' ? 'arrowUp' : 'arrowDown',
    text:`${e.side === 'bull' ? 'Bull' : 'Bear'} ${e.tag}`,
  }));
  recentEvents.slice(-10).forEach(e => {
    addHorizontalLevel(chart, e.level, e.pivotTime || from, to, {
      color:e.side === 'bull' ? 'rgba(0,196,122,.55)' : 'rgba(240,61,61,.55)',
      lineStyle:e.tag === 'CHoCH' ? 1 : 2,
    });
  });
  pivots.slice(-8).forEach(p => addHorizontalLevel(chart, p.level, p.time, to, {
    color:p.type === 'high' ? 'rgba(240,61,61,.22)' : 'rgba(0,196,122,.22)',
    lineStyle:3,
  }));
  orderBlocks.slice(-8).forEach(ob => {
    const color = ob.side === 'bull' ? 'rgba(49,121,245,.42)' : 'rgba(247,124,128,.42)';
    addHorizontalLevel(chart, ob.top, ob.time, to, { color, lineStyle:2 });
    addHorizontalLevel(chart, ob.bottom, ob.time, to, { color, lineStyle:2 });
    addHorizontalLevel(chart, ob.mid, ob.time, to, { color:color.replace('.42', '.25'), lineStyle:3 });
    markers.push({
      time:ob.time,
      position:ob.side === 'bull' ? 'belowBar' : 'aboveBar',
      color:ob.side === 'bull' ? '#3179f5' : '#f77c80',
      shape:'circle',
      text:ob.side === 'bull' ? 'Bull OB' : 'Bear OB',
    });
  });
  fairValueGaps.slice(-8).forEach(g => {
    const color = g.side === 'bull' ? 'rgba(0,255,104,.35)' : 'rgba(255,0,8,.35)';
    addHorizontalLevel(chart, g.top, g.time, to, { color, lineStyle:3 });
    addHorizontalLevel(chart, g.bottom, g.time, to, { color, lineStyle:3 });
    markers.push({
      time:g.time,
      position:g.side === 'bull' ? 'belowBar' : 'aboveBar',
      color:g.side === 'bull' ? '#00c47a' : '#f03d3d',
      shape:'square',
      text:g.side === 'bull' ? 'Bull FVG' : 'Bear FVG',
    });
  });
  equalLevels.forEach(eq => {
    addHorizontalLevel(chart, eq.level, eq.from || from, to, {
      color:eq.type === 'high' ? 'rgba(240,61,61,.50)' : 'rgba(0,196,122,.50)',
      lineStyle:1,
    });
    markers.push({
      time:eq.time,
      position:eq.type === 'high' ? 'aboveBar' : 'belowBar',
      color:eq.type === 'high' ? '#f03d3d' : '#00c47a',
      shape:'circle',
      text:eq.type === 'high' ? 'EQH' : 'EQL',
    });
  });
  const swingHigh = [...pivots].reverse().find(p => p.type === 'high');
  const swingLow = [...pivots].reverse().find(p => p.type === 'low');
  if (swingHigh && swingLow && swingHigh.level !== swingLow.level) {
    const top = Math.max(swingHigh.level, swingLow.level);
    const bottom = Math.min(swingHigh.level, swingLow.level);
    const eq = (top + bottom) / 2;
    const premium = bottom + (top - bottom) * 0.75;
    const discount = bottom + (top - bottom) * 0.25;
    addHorizontalLevel(chart, premium, Math.min(swingHigh.time, swingLow.time), to, { color:'rgba(240,61,61,.22)', lineStyle:3 });
    addHorizontalLevel(chart, eq, Math.min(swingHigh.time, swingLow.time), to, { color:'rgba(135,139,148,.35)', lineStyle:2 });
    addHorizontalLevel(chart, discount, Math.min(swingHigh.time, swingLow.time), to, { color:'rgba(0,196,122,.22)', lineStyle:3 });
  }
  candleSeries.setMarkers(markers.slice(-120));
  drawMainSmcCanvasOverlay(chart, candleSeries, candles, smcData);
}

function drawMainTradeLevels(chart, series, candles, trade) {
  if (Array.isArray(trade)) {
    trade.forEach((t, i) => drawMainTradeLevels(chart, series, candles, {
      ...t,
      _levelPrefix: t.ticker || `Setup ${i + 1}`,
    }));
    return;
  }
  if (!chart || !series || !candles?.length || !trade?.entry) return;
  const firstTime = candles[0].time;
  const lastTime = candles[candles.length - 1].time;
  const prefix = trade._levelPrefix ? `${trade._levelPrefix} ` : '';
  const levels = [
    { price:trade.entry, color:'rgba(232,237,243,.95)', title:`${prefix}Entry` },
    ...(trade.sl ? [{ price:trade.sl, color:'rgba(240,61,61,.95)', title:`${prefix}SL` }] : []),
    ...(trade.tp1 ? [{ price:trade.tp1, color:'rgba(0,196,122,.75)', title:`${prefix}TP1` }] : []),
    ...(trade.tp2 ? [{ price:trade.tp2, color:'rgba(0,196,122,.88)', title:`${prefix}TP2` }] : []),
    ...(trade.tp3 ? [{ price:trade.tp3, color:'rgba(0,196,122,1)', title:`${prefix}TP3` }] : []),
    ...tradeInvalidations(trade).map((x,i) => ({ price:x.price, color:'rgba(56,189,248,.95)', title:`${prefix}${x.label || `Inv ${i+1}`}` })),
  ];
  levels.forEach(lvl => {
    addHorizontalLevel(chart, lvl.price, firstTime, lastTime, { color:lvl.color, lineStyle:2 });
    try {
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
}

function tradeSignalUnix(trade={}) {
  return dateLikeToUnix(trade.signalTime || trade.originalMessageDate || trade.signalOriginalTime || trade.messageDate || trade.sentAt || trade.receivedAt || '');
}

function tradeExecutionUnix(trade={}) {
  if (String(trade.status || '').toLowerCase() !== 'active') return 0;
  return dateLikeToUnix(trade.executedAt || trade.executionTime || trade.openedAt || trade.createdAt || '');
}

function drawMainTradeTimeGuides(el, chart, candles, trade) {
  if (!el || !chart || !candles?.length || !trade) return;
  const trades = (Array.isArray(trade) ? trade : [trade]).filter(Boolean);
  const removers = [];
  trades.forEach((t, i) => {
    const prefix = trades.length > 1 && t.ticker ? `${t.ticker} ` : '';
    const sigTime = nearestCandleTimeForGuide(candles, tradeSignalUnix(t));
    if (sigTime) {
      const remove = addChartTimeGuide(el, chart, sigTime, `${prefix}Señal`, 'signal');
      if (remove) removers.push(remove);
    }
    const execTime = nearestCandleTimeForGuide(candles, tradeExecutionUnix(t));
    if (execTime) {
      const remove = addChartTimeGuide(el, chart, execTime, `${prefix}Ejec.`, 'execution');
      if (remove) removers.push(remove);
    }
  });
  mainChartState.guideRemovers = (mainChartState.guideRemovers || []).concat(removers);
}

async function loadMainChart(symbol = mainChartState.symbol) {
  const el = document.getElementById('mainChart');
  const obvEl = document.getElementById('mainObvChart');
  if (!el || !symbol) return null;
  mainChartState.symbol = symbol;
  const title = document.getElementById('mainChartSymbol');
  const meta = document.getElementById('mainChartMeta');
  if (title) title.textContent = symbol;
  if (meta) meta.textContent = `${mainChartLabel(mainChartState.tf)} ${mainChartState.log ? 'Log' : 'Lineal'}`;
  clearMainChart();
  el.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--t3);font-family:var(--mono);font-size:12px;">Cargando grafico...</div>`;
  try {
    await window.ensureLightweightCharts?.();
    const candles = await fetchOHLCV(symbol, mainChartState.tf, mainChartLimit(mainChartState.tf));
    if (!candles.length) throw new Error('Sin datos');
    el.innerHTML = '';
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth || 900,
      height: el.clientHeight || 520,
      layout:{ background:{color:'transparent'}, textColor:'#8ea0b5' },
      localization:{ priceFormatter: mauexChartPriceFormatter },
      grid:{ vertLines:{color:'rgba(255,255,255,0.035)'}, horzLines:{color:'rgba(255,255,255,0.035)'} },
      crosshair:{ mode:1 },
      rightPriceScale:{ mode: mainChartState.log ? 1 : 0, borderColor:'rgba(255,255,255,0.10)', scaleMargins:{top:0.05,bottom:0.20} },
      timeScale:{ borderColor:'rgba(255,255,255,0.10)', timeVisible:true, secondsVisible:false },
      handleScroll:{ mouseWheel:true, pressedMouseMove:true, horzTouchDrag:true, vertTouchDrag:true },
      handleScale:{ axisPressedMouseMove:true, mouseWheel:true, pinch:true },
    });
    mainChartState.chart = chart;
    const candlesSeries = chart.addCandlestickSeries({
      upColor:'#00c47a', downColor:'#f03d3d',
      borderUpColor:'#00c47a', borderDownColor:'#f03d3d',
      wickUpColor:'#00a85a', wickDownColor:'#c03030',
      priceFormat: mauexPriceSeriesFormat(),
    });
    candlesSeries.setData(candles);
    [
      {p:20, color:'rgba(240,200,60,0.95)'},
      {p:50, color:'rgba(61,156,240,0.95)'},
      ...(candles.length >= 220 ? [{p:200, color:'rgba(240,80,80,0.85)'}] : []),
    ].forEach(({p,color}) => {
      if (candles.length < p) return;
      const s = chart.addLineSeries({ color, lineWidth:1, priceLineVisible:false, lastValueVisible:false, priceFormat: mauexPriceSeriesFormat() });
      s.setData(calcEMA(candles, p));
    });
    const vol = chart.addHistogramSeries({
      priceFormat:{type:'volume'},
      priceScaleId:'volume',
      priceLineVisible:false,
      lastValueVisible:false,
    });
    vol.setData(candles.map(c => ({
      time:c.time,
      value:c.volume,
      color:c.close >= c.open ? 'rgba(0,196,122,0.28)' : 'rgba(240,61,61,0.28)',
    })));
    chart.priceScale('volume').applyOptions({ scaleMargins:{top:0.82,bottom:0} });
    if (mainChartState.emaRibbon) drawEmaRibbon(chart, candles);
    if (_analysisTradeData) {
      drawMainTradeLevels(chart, candlesSeries, candles, _analysisTradeData);
      drawMainTradeTimeGuides(el, chart, candles, _analysisTradeData);
    }
    if (mainChartState.smc) drawSmcOverlay(chart, candlesSeries, candles);
    else candlesSeries.setMarkers([]);
    chart.timeScale().fitContent();
    el.ondblclick = () => chart.timeScale().fitContent();
    mainChartState.resize = new ResizeObserver(() => chart.applyOptions({ width:el.clientWidth, height:el.clientHeight || 520 }));
    mainChartState.resize.observe(el);
    if (obvEl) {
      const obvChart = LightweightCharts.createChart(obvEl, {
        width: obvEl.clientWidth || 900,
        height: obvEl.clientHeight || 110,
        layout:{ background:{color:'transparent'}, textColor:'#8ea0b5' },
        grid:{ vertLines:{color:'rgba(255,255,255,0.025)'}, horzLines:{color:'rgba(255,255,255,0.025)'} },
        rightPriceScale:{ borderColor:'rgba(255,255,255,0.10)', scaleMargins:{top:0.12,bottom:0.10} },
        timeScale:{ borderColor:'rgba(255,255,255,0.10)', timeVisible:true, secondsVisible:false },
        handleScroll:{ mouseWheel:true, pressedMouseMove:true, horzTouchDrag:true },
        handleScale:{ axisPressedMouseMove:true, mouseWheel:true, pinch:true },
      });
      mainChartState.obvChart = obvChart;
      const obvSeries = obvChart.addLineSeries({
        color:'rgba(61,156,240,.9)',
        lineWidth:1.5,
        priceLineVisible:false,
        lastValueVisible:false,
      });
      obvSeries.setData(calcOBV(candles));
      obvChart.timeScale().fitContent();
      let syncingObvRange = false;
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (!range || syncingObvRange) return;
        syncingObvRange = true;
        try { obvChart.timeScale().setVisibleLogicalRange(range); } catch(e) {}
        syncingObvRange = false;
      });
      obvChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (!range || syncingObvRange) return;
        syncingObvRange = true;
        try { chart.timeScale().setVisibleLogicalRange(range); } catch(e) {}
        syncingObvRange = false;
      });
      mainChartState.obvResize = new ResizeObserver(() => obvChart.applyOptions({ width:obvEl.clientWidth, height:obvEl.clientHeight || 110 }));
      mainChartState.obvResize.observe(obvEl);
    }
    return chart;
  } catch(e) {
    el.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--red);font-family:var(--mono);font-size:12px;">No pude cargar el grafico: ${esc(e.message)}</div>`;
    return null;
  }
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
    await window.ensureLightweightCharts?.();
    // More candles so EMA200 always renders
    const limit = tfKey==='1M'?48:tfKey==='1W'?150:tfKey==='1D'?300:250;
    const candles = await fetchOHLCV(symbol, interval, limit);
    if(!candles.length) throw new Error('Sin datos');

    // ── Candlestick chart with EMAs ───────────────────────────────────────
    const csChart = makeChart(csEl, tfKey === '1M' ? 320 : 220);
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
    csEl.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:150px;color:var(--t3);font-family:var(--mono);font-size:11px;">Error: ${esc(e.message)}</div>`;
    console.error(tfKey, e);
    return null;
  }
}

// ── Fetch market data (Binance + Fear&Greed) ─────────────────────────────
async function fetchMarketData(symbol) {
  const data = {};
  try {
    // 24h ticker
    const fetchFn = window.publicFetch || fetch;
    const src = String(window._aiSource || 'binance').toLowerCase();
    const kind = aiMarketType === 'spot' ? 'spot' : 'futures';
    if (src === 'bybit') {
      const bybitSymbol = chartSymbolForExchange(symbol, 'bybit', kind);
      const r = await fetchFn(`https://api.bybit.com/v5/market/tickers?category=${kind === 'spot' ? 'spot' : 'linear'}&symbol=${encodeURIComponent(bybitSymbol)}`);
      const d = await r.json();
      const row = d.result?.list?.[0] || {};
      data.price = parseFloat(row.lastPrice);
      data.change24h = parseFloat(row.price24hPcnt) * 100;
      data.vol24h = parseFloat(row.turnover24h || 0);
      data.high24h = parseFloat(row.highPrice24h);
      data.low24h = parseFloat(row.lowPrice24h);
    } else if (src === 'okx') {
      const instId = chartSymbolForExchange(symbol, 'okx', kind);
      const r = await fetchFn(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`);
      const d = await r.json();
      const row = d.data?.[0] || {};
      data.price = parseFloat(row.last);
      const open = parseFloat(row.open24h);
      data.change24h = open ? (data.price - open) / open * 100 : null;
      data.vol24h = parseFloat(row.volCcy24h || row.vol24h || 0);
      data.high24h = parseFloat(row.high24h);
      data.low24h = parseFloat(row.low24h);
    } else if (src === 'mexc' && kind === 'futures') {
      const mexcSym = chartSymbolForExchange(symbol, 'mexc', 'futures');
      const r = await fetchFn(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(mexcSym)}`);
      const d = await r.json();
      const row = Array.isArray(d.data) ? d.data[0] : d.data || {};
      data.price = parseFloat(row.lastPrice || row.lastPriceFair || row.fairPrice);
      data.change24h = parseFloat(row.riseFallRate) * 100;
      data.vol24h = parseFloat(row.amount24 || row.volume24 || 0);
      data.high24h = parseFloat(row.high24Price || row.high24);
      data.low24h = parseFloat(row.low24Price || row.low24);
    } else if (src === 'kucoin' && kind === 'spot') {
      const kucoinSymbol = chartSymbolForExchange(symbol, 'kucoin', 'spot');
      const r = await fetchFn(`https://api.kucoin.com/api/v1/market/stats?symbol=${encodeURIComponent(kucoinSymbol)}`);
      const d = await r.json();
      const row = d.data || {};
      data.price = parseFloat(row.last);
      data.change24h = parseFloat(row.changeRate) * 100;
      data.vol24h = parseFloat(row.volValue || 0);
      data.high24h = parseFloat(row.high);
      data.low24h = parseFloat(row.low);
    } else if (src === 'kucoin' && kind === 'futures') {
      const kucoinSymbol = chartSymbolForExchange(symbol, 'kucoin', 'futures');
      const r = await fetchFn(`https://api-futures.kucoin.com/api/v1/ticker?symbol=${encodeURIComponent(kucoinSymbol)}`);
      const d = await r.json();
      const row = d.data || {};
      data.price = parseFloat(row.price || row.bestBidPrice || row.bestAskPrice);
      data.change24h = parseFloat(row.changeRate) * 100;
      data.vol24h = parseFloat(row.turnoverOf24h || row.volumeOf24h || 0);
      data.high24h = parseFloat(row.highPrice || row.highPriceOf24h);
      data.low24h = parseFloat(row.lowPrice || row.lowPriceOf24h);
    } else {
      const binanceSymbol = chartSymbolForExchange(symbol, 'binance', kind);
      const r = await fetchFn(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(binanceSymbol)}`);
      const d = await r.json();
      data.price     = parseFloat(d.lastPrice);
      data.change24h = parseFloat(d.priceChangePercent);
      data.vol24h    = parseFloat(d.quoteVolume);
      data.high24h   = parseFloat(d.highPrice);
      data.low24h    = parseFloat(d.lowPrice);
    }
  } catch(e){}

  try {
    // Funding rate (futures)
    if (String(window._aiSource || 'binance').toLowerCase() !== 'binance') throw new Error('skip non-binance funding');
    const binanceSymbol = chartSymbolForExchange(symbol, 'binance', 'futures');
    const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(binanceSymbol)}&limit=1`);
    const d = await r.json();
    if(d[0]) data.fundingRate = parseFloat(d[0].fundingRate)*100;
  } catch(e){}

  try {
    // Open Interest
    if (String(window._aiSource || 'binance').toLowerCase() !== 'binance') throw new Error('skip non-binance oi');
    const binanceSymbol = chartSymbolForExchange(symbol, 'binance', 'futures');
    const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(binanceSymbol)}`);
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
    <span style="color:var(--t1);font-size:13px;font-weight:600;">${esc(symbol)}</span>
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
  if (chartsLoading) return;
  chartsLoading = true;
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
    const graphVisible = document.getElementById('chartsTabGraficosContent')?.style.display !== 'none';
    const aiVisible = document.getElementById('chartsTabAIContent')?.style.display !== 'none';
    const [mainChart, md] = await Promise.all([
      graphVisible ? loadMainChart(symbol) : Promise.resolve(null),
      fetchMarketData(symbol),
    ]);
    let ema1D = {};
    if (aiVisible) {
      const [res1M, res1W, res1D] = await Promise.all([
        renderTFCharts('1M', symbol, '1M'),
        renderTFCharts('1W', symbol, '1w'),
        renderTFCharts('1D', symbol, '1d'),
      ]);
      await Promise.all([
        renderTFCharts('4H', symbol, '4h'),
        renderTFCharts('1H', symbol, '1h'),
      ]);
      ema1D = res1D?.emaValues || {};
    }
    renderMarketStrip(symbol, md, ema1D, aiMarketType);
  } catch(e){ console.error(e); toast('Error cargando charts: '+e.message,'error'); }
  btn.textContent='↺ Cargar'; btn.disabled=false;
  chartsLoading = false;

  // Draw trade levels if opened from watchlist
  if(_analysisTradeData) {
    renderTradeInfoPanel(_analysisTradeData);
    // Draw price lines on all candlestick charts
    ['1M','1W','1D','4H','1H'].forEach(tf=>{
      const csChart = lwCharts['cs'+tf];
      const trades = (Array.isArray(_analysisTradeData) ? _analysisTradeData : [_analysisTradeData]).filter(t => t?.entry);
      if(!csChart||!trades.length) return;
      try {
        const levels = trades.flatMap((trade, idx) => {
          const prefix = trades.length > 1 ? `${trade.ticker || 'Setup '+(idx+1)} ` : '';
          return [
            {price:trade.entry, color:'rgba(232,237,243,0.9)', title:prefix+'Entry', width:1},
            ...(trade.sl?  [{price:trade.sl,  color:'rgba(240,61,61,0.9)',  title:prefix+'SL',  width:1}]:[]),
            ...(trade.tp1? [{price:trade.tp1, color:'rgba(0,196,122,0.7)', title:prefix+'TP1', width:1}]:[]),
            ...(trade.tp2? [{price:trade.tp2, color:'rgba(0,196,122,0.85)',title:prefix+'TP2', width:1}]:[]),
            ...(trade.tp3? [{price:trade.tp3, color:'rgba(0,196,122,1.0)', title:prefix+'TP3', width:1}]:[]),
          ];
        });
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
              priceFormat: mauexPriceSeriesFormat(),
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
