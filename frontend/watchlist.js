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
  const savedOpen = all.filter(t => ['active','pending','watchlist'].includes(t.status));
  const livePositions = (window.exchangePositions || []).map(p => ({
    ...p,
    status: 'active',
    exchange: p.exchange || p.exchangeSource,
    traderName: p.traderName || 'Exchange live',
  }));
  const liveOrders = (window.exchangeOrders || []).map(o => ({
    ...o,
    status: 'pending',
    exchange: o.exchange || o.exchangeSource,
    traderName: o.traderName || 'Exchange live',
  }));
  const open = [...savedOpen, ...livePositions, ...liveOrders];
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

function chartsIconButton(id, label='Abrir en Charts') {
  return `<button title="${label}" aria-label="${label}"
    style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
    onclick="openTradeInAnalysis('${id}')">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="display:block;">
      <path d="M3 3v18h18"/><path d="M7 15l3-3 3 2 5-7"/><path d="M18 7h-4"/><path d="M18 7v4"/>
    </svg>
  </button>`;
}

// ── Card minimize/maximize memory ──────────────────────────────────────────
function calculatorIconButton(id, label='Recalcular en Calculadora') {
  return `<button title="${label}" aria-label="${label}"
    style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
    onclick="window.loadTradeIntoCalculator('${id}')">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="display:block;">
      <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 10h2"/><path d="M12 10h2"/><path d="M16 10h.01"/><path d="M8 14h2"/><path d="M12 14h2"/><path d="M16 14h.01"/><path d="M8 18h2"/><path d="M12 18h2"/><path d="M16 18h.01"/>
    </svg>
  </button>`;
}

function setCalculatorEditMode(id='') {
  window._calcEditingTradeId = id || null;
  const actions = document.querySelector('.calc-actions-final');
  if (!actions) return;
  actions.classList.toggle('editing-existing-trade', !!id);
  actions.title = id ? 'Estas recalculando una tarjeta existente. Al guardar se actualiza esa misma tarjeta.' : '';
}

window.clearCalculatorEditMode = () => {
  setCalculatorEditMode('');
  calcChartState.signalTime = 0;
  calcChartState.key = '';
};

window.loadTradeIntoCalculator = id => {
  const t = (window.G?.trades?.() || []).find(x => x.id === id);
  if (!t) { toast('No encontre esa tarjeta.', 'error'); return; }
  const set = (fieldId, value) => {
    const el = document.getElementById(fieldId);
    if (el) el.value = value ?? '';
  };
  const dir = t.dir || 'long';
  window.showPage('calc');
  setCalculatorEditMode(id);
  calcChartState.signalTime = dateLikeToUnix(t.signalTime || t.originalMessageDate || t.messageDate || t.sentAt || t.receivedAt || '');
  calcChartState.key = '';
  window._signalTradeExtras = null;
  window.clearCalcSignalTargets?.();
  setDir(dir);
  if (dir !== 'spot') {
    const ex = String(t.exchange || userPrefs?.exchange || 'binance').toLowerCase();
    if (['binance','bybit','okx','mexc','kucoin'].includes(ex)) setEx(ex);
  }
  if (Number(t.leverage || 0) > 0) pickLev(Number(t.leverage));
  set('cTicker', t.ticker || '');
  setCalcTickerSource(t.marketSource || 'auto', t.marketType || '', t.marketKind || '');
  set('cEntry', Number(t.entry || 0) || '');
  set('cSL', Number(t.sl || 0) || '');
  set('cRisk', Number(t.risk || 0) || '');
  set('cSize', Number(t.posSize || 0) || '');
  set('cTP1', Number(t.tp1 || 0) || '');
  set('cTP1pct', Number(t.tp1pct || 0) || '');
  set('cTP2', Number(t.tp2 || 0) || '');
  set('cTP2pct', Number(t.tp2pct || 0) || '');
  set('cTP3', Number(t.tp3 || 0) || '');
  set('cTP3pct', Number(t.tp3pct || 0) || '');
  setCalcTpPercentsManual([t.tp1pct, t.tp2pct, t.tp3pct].some(v => Number(v || 0) > 0));
  set('cTrader', t.traderId || '');
  set('cNotes', t.notes || '');
  const invs = tradeInvalidations(t);
  set('cInv1', invs[0]?.price || '');
  set('cInv1Side', invs[0]?.side || 'up');
  set('cInv2', invs[1]?.price || '');
  set('cInv2Side', invs[1]?.side || 'up');
  set('cInvNote', invs.find(x => x.note)?.note || '');
  renderCalcSignalTargets();
  compute();
  toast('Tarjeta cargada en Calculadora para recalcular.');
};

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

window._watchSelected = window._watchSelected || new Set();

function watchlistItems() {
  return (window.G?.trades?.() || []).filter(t => t.status === 'watchlist');
}

function selectedWatchlistItems() {
  const selected = window._watchSelected || new Set();
  return watchlistItems().filter(t => selected.has(t.id));
}

function syncWatchlistBulkUi(items = watchlistItems()) {
  const selected = window._watchSelected || new Set();
  const validIds = new Set(items.map(t => t.id));
  [...selected].forEach(id => { if (!validIds.has(id)) selected.delete(id); });
  const count = selected.size;
  const total = items.length;
  const selectBtn = document.getElementById('watchSelectAllBtn');
  const deleteBtn = document.getElementById('watchBulkDeleteBtn');
  const chartBtn = document.getElementById('watchBulkChartBtn');
  const exportBtn = document.getElementById('watchBulkExportBtn');
  if (selectBtn) selectBtn.textContent = count && count === total ? 'Quitar seleccion' : `Seleccionar todo${count ? ` (${count})` : ''}`;
  [deleteBtn, chartBtn, exportBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = !count;
    btn.style.opacity = count ? '1' : '.45';
    btn.style.pointerEvents = count ? 'auto' : 'none';
  });
}

window.toggleWatchlistSelection = (id, checked) => {
  window._watchSelected = window._watchSelected || new Set();
  if (checked) window._watchSelected.add(id);
  else window._watchSelected.delete(id);
  const card = document.querySelector(`[data-watch-card-id="${id}"]`);
  if (card) card.classList.toggle('watch-selected', !!checked);
  syncWatchlistBulkUi();
};

window.toggleAllWatchlistSelection = () => {
  const items = watchlistItems();
  window._watchSelected = window._watchSelected || new Set();
  const allSelected = items.length && items.every(t => window._watchSelected.has(t.id));
  if (allSelected) items.forEach(t => window._watchSelected.delete(t.id));
  else items.forEach(t => window._watchSelected.add(t.id));
  renderWatchlist();
};

window.deleteSelectedWatchlist = async () => {
  const items = selectedWatchlistItems();
  if (!items.length) { toast('Selecciona al menos una tarjeta.', 'error'); return; }
  if (!confirm(`Eliminar ${items.length} setup(s) del Watchlist?`)) return;
  try {
    const {deleteDoc, doc, db} = window._fb || {};
    if (!deleteDoc || !doc || !db) throw new Error('Firebase no esta listo');
    await Promise.all(items.map(t => deleteDoc(doc(db,'trades',t.id))));
    items.forEach(t => window._watchSelected.delete(t.id));
    await window._loadTrades?.();
    renderWatchlist();
    toast(`${items.length} setup(s) eliminados.`);
  } catch(e) {
    toast('No pude eliminar: ' + e.message, 'error');
  }
};

function tradeChartMarketInfo(t={}) {
  const rawTicker = String(t?.ticker || '').trim().toUpperCase();
  const explicitSource = String(t?.marketSource || '').toLowerCase();
  const explicitType = String(t?.marketType || '').toLowerCase();
  const explicitKind = String(t?.marketKind || '').toLowerCase() || (t?.dir === 'spot' ? 'spot' : 'futures');
  if (explicitSource === 'yahoo') return { raw:rawTicker, symbol:rawTicker, source:'yahoo', type:explicitType || 'stock', marketKind:'spot' };
  if (cryptoExchangeSource(explicitSource)) {
    return {
      raw: rawTicker,
      symbol: chartSymbolForExchange(rawTicker, explicitSource, explicitKind),
      source: explicitSource,
      type: explicitType || 'crypto',
      marketKind: explicitKind,
    };
  }
  const crypto = explicitSource === 'binance' || rawTicker.endsWith('USDT') || rawTicker.endsWith('BUSD') || appIsCryptoTicker(rawTicker, t?.exchange);
  const base = rawTicker.replace(/USDT|BUSD|USD$/,'');
  return {
    raw: rawTicker,
    symbol: crypto ? base + 'USDT' : rawTicker,
    source: crypto ? 'binance' : 'yahoo',
    type: explicitType || (crypto ? 'crypto' : 'stock'),
    marketKind: crypto ? explicitKind : 'spot',
  };
}

function normalizeChartTicker(t) {
  return tradeChartMarketInfo(t).symbol;
}

window.openSelectedWatchlistInCharts = () => {
  const items = selectedWatchlistItems();
  if (!items.length) { toast('Selecciona al menos una tarjeta.', 'error'); return; }
  const firstSymbol = normalizeChartTicker(items[0]);
  const comparable = items.filter(t => normalizeChartTicker(t) === firstSymbol);
  if (comparable.length < items.length) {
    toast(`Abro ${comparable.length} de ${items.length}: para comparar, las tarjetas deben ser del mismo ticker.`, 'error');
  }
  _analysisTradeData = comparable;
  const aiSym = document.getElementById('aiSymbol');
  if (aiSym) aiSym.value = firstSymbol;
  const first = comparable[0];
  const info = tradeChartMarketInfo(first);
  window._aiSource = info.source;
  window._aiType = info.type;
  mainChartState.symbol = firstSymbol;
  setMarketType(info.source === 'yahoo' ? 'spot' : (info.marketKind || (first?.dir === 'spot' ? 'spot' : 'futures')));
  window.showPage('analysis');
  if (typeof showChartsTab === 'function') showChartsTab('graficos');
  setTimeout(() => { if (typeof loadCharts === 'function') loadCharts(); }, 250);
};

function watchlistExportPayload(items) {
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Analisis AI de setups seleccionados en Watchlist MAUex',
    count: items.length,
    setups: items.map(t => {
      const sym = String(t.ticker || '').replace(/USDT|BUSD|USD$/,'').toUpperCase();
    const currentPrice = window.G?.getTradePrice?.(t) || window.G?.getPrice?.(sym, t.dir) || window.G?.getPrice?.(t.ticker, t.dir) || null;
      return {
        ticker: t.ticker || '',
        direction: t.dir || '',
        exchange: t.exchange || '',
        trader: t.traderName || '',
        leverage: Number(t.leverage || 1),
        currentPrice,
        entry: Number(t.entry || 0) || null,
        stopLoss: Number(t.sl || 0) || null,
        liquidation: Number(t.liquidation || estimatedLiquidationPrice(t) || 0) || null,
        takeProfits: [
          t.tp1 ? { level:'TP1', price:Number(t.tp1), pct:Number(t.tp1pct || 33) } : null,
          t.tp2 ? { level:'TP2', price:Number(t.tp2), pct:Number(t.tp2pct || 33) } : null,
          t.tp3 ? { level:'TP3', price:Number(t.tp3), pct:Number(t.tp3pct || 34) } : null,
        ].filter(Boolean),
        riskUsd: Number(t.risk || 0) || null,
        positionUsd: Number(t.posSize || 0) || null,
        notes: t.notes || '',
        invalidations: tradeInvalidations(t).map(x => ({ price:x.price, side:x.side, note:x.note || '' })),
      };
    }),
  };
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

window.exportSelectedWatchlistForAI = async () => {
  const items = selectedWatchlistItems();
  if (!items.length) { toast('Selecciona al menos una tarjeta.', 'error'); return; }
  const content = JSON.stringify(watchlistExportPayload(items), null, 2);
  try {
    await navigator.clipboard.writeText(content);
    toast(`${items.length} setup(s) copiados para pegar en AI.`);
  } catch(e) {
    downloadTextFile(`mauex_watchlist_${new Date().toISOString().slice(0,10)}.txt`, content);
    toast('No pude copiar; descargue un archivo .txt.');
  }
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
    syncWatchlistBulkUi(items);
    container.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><div class="empty-text">No hay setups en watchlist</div><div class="empty-sub">Agregá un setup desde la Calculadora</div></div>`;
    return;
  }
  if (typeof startLivePrices === 'function') setTimeout(startLivePrices, 100);

  const cardStates = getCardState();

  container.innerHTML = items.map(t => {
    const G = window.G;
    const sym = String(t.ticker || '').trim().toUpperCase()
      .replace(/[-_]?USDTM$/,'')
      .replace(/[-_]?USDT[-_]?SWAP$/,'')
      .replace(/[-_]?USDT$/,'')
      .replace(/USDT|BUSD|USD$/,'') || t.ticker;
    const currentPrice = G?.getTradePrice?.(t) || G?.getPrice(sym, t.dir) || G?.getPrice(t.ticker, t.dir);
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
    const isSelected = !!window._watchSelected?.has(t.id);
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
            <input class="watch-select-box" type="checkbox" ${isSelected?'checked':''}
              onclick="event.stopPropagation();" onchange="window.toggleWatchlistSelection('${t.id}', this.checked)">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--red);flex-shrink:0;"></div>
            <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--t1);">${dashSafe(t.ticker||'—')}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${dirBg};color:${dirColor};font-family:var(--mono);border:0.5px solid ${dirBorder};">${dirLevLabel(t)}</span>
            ${t.exchange?`<a href="${getExchangeUrl(t.exchange,t.ticker,t.dir)||'#'}" target="_blank" rel="noopener"
              style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2);text-decoration:none;">${dashSafe(t.exchange)} ↗</a>`:''}
            ${t.traderName?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);">· ${dashSafe(t.traderName)}</span>`:''}
            ${displaySize?`<span style="font-size:10px;color:var(--blue);font-family:var(--mono);padding:2px 7px;border-radius:4px;background:var(--blue-dim);border:0.5px solid rgba(61,156,240,0.2);">Cap $${fmt(displaySize)}</span>`:''}
            ${entryBadge}
            ${invalidAlert.badges?`<span style="display:inline-flex;gap:4px;">${invalidAlert.badges}</span>`:''}
            ${currentPrice&&distToEntry!=null?`<span style="font-size:10px;color:${distColor};font-family:var(--mono);">${distToEntry>=0?'▲':'▼'} ${Math.abs(distToEntry).toFixed(2)}% al entry</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div style="text-align:right;">
            <div style="font-size:14px;font-weight:600;font-family:var(--mono);color:var(--t1);" data-watchpx="${sym}" data-watchdir="${t.dir}" data-watchsource="${t.marketSource || ''}" data-watchkind="${t.marketKind || ''}">${currentPrice?'$'+fmtPx(currentPrice):'—'}</div>
            <div style="font-size:10px;color:var(--t3);font-family:var(--mono);">precio actual</div>
          </div>
          ${collapseBtn}
        </div>
      </div>`;

    if (isMin) {
      return `<div class="${watchCardClass} ${isSelected?'watch-selected':''}" data-watch-card-id="${t.id}" draggable="true" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${watchBorderColor};margin-bottom:8px;overflow:hidden;cursor:grab;">
        ${header}
        ${fakeT.entry&&(fakeT.sl||fakeT.tp1)?`<div style="padding:0 16px 14px;">${buildPriceBar(fakeT, currentPrice||0)}</div>`:''}
      </div>`;
    }

    return `<div class="${watchCardClass} ${isSelected?'watch-selected':''}" data-watch-card-id="${t.id}" draggable="true" style="background:var(--bg2);border-radius:var(--rl);border:0.5px solid var(--border);border-left:3px solid ${watchBorderColor};margin-bottom:8px;overflow:hidden;cursor:grab;">
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

      ${cleanAutoCloseNotes(t.notes)?`<div style="font-size:11px;color:var(--t2);padding:6px 12px;background:var(--bg3);border-bottom:0.5px solid var(--border2);">${dashSafe(cleanAutoCloseNotes(t.notes))}</div>`:''}
      ${invalidationNotesHtml(t)}

      <div style="display:grid;grid-template-columns:2fr repeat(4,1fr);gap:8px;padding:10px 14px;background:rgba(0,0,0,0.15);">
        <select onchange="window.moveCardToStatus('${t.id}', this.value)"
          style="background:var(--bg3);color:var(--t2);border:0.5px solid var(--border2);border-radius:8px;padding:7px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;">
          <option value="watchlist" selected>👁 Watchlist</option>
          <option value="pending">⏳ Órdenes</option>
          <option value="active">🟢 Posición</option>
        </select>
        ${chartsIconButton(t.id)}
        ${calculatorIconButton(t.id)}
        <button style="background:var(--bg3);color:var(--t3);border:0.5px solid var(--border2);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="openEditTrade('${t.id}')">✎</button>
        <button style="background:rgba(224,82,82,0.08);color:var(--red);border:0.5px solid rgba(224,82,82,0.15);border-radius:8px;padding:7px;font-size:13px;cursor:pointer;" onclick="deleteTrade('${t.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
  attachWatchlistDrag();
  syncWatchlistBulkUi(items);
}
