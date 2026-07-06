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
      <div style="font-size:10px;color:var(--t2);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dashSafe(name)}">${dashSafe(name)}</div>
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
  const histMetrics = document.getElementById('histMetrics');
  if (histMetrics) {
    const best = filtered.reduce((b,t)=>(t.pnl||0)>(b.pnl||0)?t:b,{pnl:0});
    const worst = filtered.reduce((w,t)=>(t.pnl||0)<(w.pnl||0)?t:w,{pnl:0});
    histMetrics.innerHTML = [
      {l:'Trades filtrados',v:String(filtered.length),sub:`${closed.length} cerrados`},
      {l:'Win rate',v:filtered.length?Math.round(wins/filtered.length*100)+'%':'—',cls:filtered.length&&wins/filtered.length>=.5?'green':'red'},
      {l:'PnL filtrado',v:(totPnl>=0?'+':'')+'$'+fmt(Math.abs(totPnl)),cls:totPnl>=0?'green':'red'},
      {l:'Mejor trade',v:best.pnl?'+$'+fmt(best.pnl):'—',sub:best.ticker||'',cls:'green'},
      {l:'Peor trade',v:worst.pnl<0?'-$'+fmt(Math.abs(worst.pnl)):'—',sub:worst.ticker||'',cls:'red'},
      {l:'Activos',v:String([...new Set(filtered.map(t=>t.ticker).filter(Boolean))].length)},
    ].map(dashMetricCard).join('');
  }
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
      <td><strong>${dashSafe(t.ticker||'—')}</strong></td>
      <td><span class="badge ${dirBadge}">${(t.dir||'').toUpperCase()}</span></td>
      <td style="color:var(--t2);">${dashSafe(t.exchange?.toUpperCase()||'—')}</td>
      <td style="color:var(--t2);">${dashSafe(t.traderName||'—')}</td>
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
        <div><div style="font-family:var(--mono);font-size:15px;font-weight:600;">${dashSafe(t.name)}</div>${t.channel?`<div style="font-size:11px;color:var(--t2);margin-top:2px;">${dashSafe(t.channel)}</div>`:''}</div>
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
      ${t.notes?`<div style="font-size:11px;color:var(--t2);">${dashSafe(t.notes)}</div>`:''}
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
  'SL a entry',
  'SL mas cerca del entry',
  'SL mas lejos del entry',
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
  const selectedReasonTags = [...document.querySelectorAll('[data-edit-change-reason].selected')]
    .map(x => x.dataset.editChangeReason)
    .filter(Boolean);
  const autoReasonTags = [];
  const beforeSl = Number(before?.sl || 0);
  const afterSl = Number(after?.sl || 0);
  const afterEntry = Number(after?.entry || 0);
  if (afterSl > 0 && afterEntry > 0 && beforeSl !== afterSl && Math.abs(afterSl - afterEntry) <= Math.max(afterEntry * 0.000001, 0.00000001)) {
    autoReasonTags.push('SL a entry');
  }
  const reasonTags = [...selectedReasonTags, ...autoReasonTags];
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
  refreshEditLiquidationEstimate();
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
        G.traders().map(tr=>`<option value="${dashSafe(tr.id)}"${tr.id===t.traderId?' selected':''}>${dashSafe(tr.name)}</option>`).join('');
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
    window.renderDirectTradeReviewTags?.(t);
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
    traders.map(tr=>`<option value="${dashSafe(tr.id)}"${tr.id===t?.traderId?' selected':''}>${dashSafe(tr.name)}</option>`).join('');
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
    const eExchangeEl = document.getElementById('eExchange');
    const eLevEl = document.getElementById('eLev');
    if (eExchangeEl) eExchangeEl.oninput = () => refreshEditLiquidationEstimate();
    if (eLevEl) eLevEl.oninput = () => refreshEditLiquidationEstimate();
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
  const lev      = parseFloat(document.getElementById('eLev').value)||1;
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
      G.traders().map(t=>`<option value="${dashSafe(t.id)}">${dashSafe(t.name)}</option>`).join('');
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
