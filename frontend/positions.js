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

function signalNavTimeOf(sig) {
  const raw = sig?.lastTelegramUpdateAt || sig?.receivedAt || sig?.importedAt || sig?.updatedAt || sig?.createdAt || signalOriginalTime(sig);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signalNavSummary(seen={}) {
  const lastSeen = Number(seen.signals) || 0;
  const summary = { count:0, color:'blue', rank:0 };
  loadSignalInbox().forEach(sig => {
    if (!sig || signalIsSuppressedStatus(sig.status)) return;
    const createdAt = signalNavTimeOf(sig) || Date.now();
    if (createdAt <= lastSeen) return;
    summary.count += 1;
    const rank = sig.status === 'review' ? 2 : 1;
    const color = sig.status === 'review' ? 'amber' : 'blue';
    if (rank > summary.rank) {
      summary.rank = rank;
      summary.color = color;
    }
  });
  return summary;
}

function navAlertSummary() {
  const seen = navAlertSeen();
  const summary = {
    signals: signalNavSummary(seen),
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
  if (page !== 'signals' && !NAV_ALERT_SECTIONS[page]) {
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
  const r = await (window.publicFetch ? window.publicFetch(url) : fetch(url));
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
    const price = G.getTradePrice?.(t) ?? G.getPrice(t.ticker, t.dir);
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
    const pA = G.getTradePrice?.(a) ?? G.getPrice(a.ticker, a.dir);
    const pB = G.getTradePrice?.(b) ?? G.getPrice(b.ticker, b.dir);
    const dA = pA && a.sl ? Math.abs(pA - a.sl) / pA : Infinity;
    const dB = pB && b.sl ? Math.abs(pB - b.sl) / pB : Infinity;
    return dA - dB;
  });

  let totalPnl = 0;
  sorted.filter(t=>t.status==='active').forEach(t => {
    const price = G.getTradePrice?.(t) ?? G.getPrice(t.ticker, t.dir);
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
    const sym    = String(t.ticker || '').trim().toUpperCase()
      .replace(/[-_]?USDTM$/,'')
      .replace(/[-_]?USDT[-_]?SWAP$/,'')
      .replace(/[-_]?USDT$/,'')
      .replace(/USDT|BUSD|USD$/,'') || t.ticker;
    const price  = G.getTradePrice?.(t) ?? G.getPrice(t.ticker, t.dir);
    const sign   = (t.dir==='short') ? -1 : 1;
    const displaySize = effectiveTradeSize(t);
    const contr  = (displaySize||0) / (t.entry||1);
    const pnl    = price!=null ? Math.round(contr*(price-t.entry)*sign*100)/100 : null;
    const isSpot = t.dir === 'spot';
    const margin = t.dir==='spot' ? displaySize : displaySize/(t.leverage||1);
    const unitsLabel = positionUnitsLabel(t, displaySize, t.entry);
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
    const riskUsd   = t.risk || (displaySize&&slDistPct ? displaySize*slDistPct/100 : null);
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
            <span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--t1);">${dashSafe(t.ticker||'—')}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;background:${dirBg};color:${dirColor};font-family:var(--mono);border:0.5px solid ${dirBorder};">${dirLevLabel(t)}</span>
            ${t.exchange?`<a href="${getExchangeUrl(t.exchange, t.ticker, t.dir)||'#'}" target="_blank" rel="noopener"
              style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2);text-decoration:none;">${dashSafe(t.exchange)} ↗</a>`:''}
            ${t.traderName?`<span style="font-size:10px;color:var(--t3);font-family:var(--mono);">· ${dashSafe(t.traderName)}</span>`:''}
            ${alert.badges?`<span style="display:inline-flex;gap:4px;">${alert.badges}</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div style="font-size:20px;font-weight:700;font-family:var(--mono);" class="${pnl==null?'':pnl>=0?'pnl-pos':'pnl-neg'}"
            data-pnl="${sym}" data-entry="${t.entry}" data-pos="${displaySize}" data-dir="${t.dir}" data-source="${t.marketSource || ''}" data-kind="${t.marketKind || ''}" data-manual="true">
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

      ${isSpot && (t.sl || margin || displaySize) ? `
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

      ${(!isSpot && (t.sl || margin || displaySize)) ? `
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
          <div style="font-size:13px;font-weight:500;font-family:var(--mono);color:var(--t3);">$${fmt(displaySize)}</div>
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

      ${cleanAutoCloseNotes(t.notes)?`<div style="font-size:11px;color:var(--t2);padding:6px 12px;background:var(--bg3);border-bottom:0.5px solid var(--border2);">${dashSafe(cleanAutoCloseNotes(t.notes))}</div>`:''}
      ${invalidationNotesHtml(t)}

      <div style="display:grid;grid-template-columns:2fr 3fr 1fr 1fr 1fr;gap:8px;padding:10px 14px;background:rgba(0,0,0,0.15);">
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
        ${chartsIconButton(t.id)}
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
  return String(t?.ticker || t?.symbol || '').trim().toUpperCase()
    .replace(/[-_]?USDTM$/,'')
    .replace(/[-_]?USDT[-_]?SWAP$/,'')
    .replace(/[-_]?USDT$/,'')
    .replace(/USDT|BUSD|USD$/,'');
}

function mapCurrentPrice(sym, items=[]) {
  const G = window.G;
  if (!G || !sym) return null;
  for (const item of items) {
    const t = item?.trade || item;
    const p = G.getTradePrice?.(t);
    if (p) return p;
  }
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
  const rowPrice = item.kind === 'position' ? (mapCurrentPrice(mapTickerOf(t), [t]) || currentPrice) : currentPrice;
  const pnl = item.kind === 'position' ? mapLivePnl(t, rowPrice) : null;
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
    <div class="map-kind" style="color:${item.color};">${dashSafe(item.label)}</div>
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
    const currentPrice = mapCurrentPrice(sym, items);
    const positions = items.filter(x=>x.kind==='position').map(x=>x.trade);
    const orders = items.filter(x=>x.kind==='order').length;
    const watches = items.filter(x=>x.kind==='watch').length;
    const pnl = positions.reduce((s,t)=>s+(mapLivePnl(t, mapCurrentPrice(sym, [t]))||0),0);
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
