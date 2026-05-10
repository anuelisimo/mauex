import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, deleteField,
         doc, query, where, setDoc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app = initializeApp({
  apiKey:"AIzaSyCPM-j5VF1LbfyA6fntOxpUh9i6FpiIwPo",
  authDomain:"mauex-8a771.firebaseapp.com",
  projectId:"mauex-8a771",
  storageBucket:"mauex-8a771.firebasestorage.app",
  messagingSenderId:"138252609601",
  appId:"1:138252609601:web:cc3b5e8e4d6bcbe571bec0"
});
const auth = getAuth(app);
const db   = getFirestore(app);
const gp   = new GoogleAuthProvider();

// ── State ──────────────────────────────────────────────────────────────────
let CU = null;
let trades  = [];   // ALL trades for current user
let traders = [];   // ALL traders for current user

// ── Expose to global scope ─────────────────────────────────────────────────
const G = window.G = {
  trades:  () => trades,
  traders: () => traders,
  uid:     () => CU?.uid || '',
};

// ── Auth ───────────────────────────────────────────────────────────────────
const errMap = {
  'auth/invalid-email':'Email inválido.',
  'auth/weak-password':'Contraseña muy corta.',
  'auth/email-already-in-use':'Email ya registrado.',
  'auth/user-not-found':'Usuario no encontrado.',
  'auth/wrong-password':'Contraseña incorrecta.',
  'auth/invalid-credential':'Credenciales incorrectas.',
  'auth/unauthorized-domain':'Este dominio local no esta autorizado en Firebase. Abrilo con localhost o agregalo en Firebase Auth.',
  'auth/popup-blocked':'El navegador bloqueo la ventana de Google. Permití popups para MAUex.',
  'auth/popup-closed-by-user':'Se cerro la ventana de Google antes de terminar el login.',
};
function authErr(code){ return errMap[code] || `Error de autenticación (${code || 'sin codigo'}).`; }
function showAE(msg){
  const el = document.getElementById('authError');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

window.doGoogleLogin = async () => {
  try { await signInWithPopup(auth, gp); }
  catch(e) { showAE(authErr(e.code)); }
};

let authMode = 'login';
window.toggleAuth = () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('authBtn').textContent       = authMode === 'login' ? 'Ingresar' : 'Registrarse';
  document.getElementById('authToggleTxt').textContent = authMode === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?';
  document.getElementById('authToggleLink').textContent = authMode === 'login' ? 'Registrarse' : 'Ingresar';
};

window.doEmailLogin = async () => {
  const email = document.getElementById('authEmail').value;
  const pass  = document.getElementById('authPass').value;
  try {
    if (authMode === 'register') await createUserWithEmailAndPassword(auth, email, pass);
    else                         await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) { showAE(authErr(e.code)); }
};

window.doLogout = () => signOut(auth);

// ── Auth state ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  CU = user;
  if (user) {
    // Show app
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('app').style.flexDirection = 'column';
    document.getElementById('statusBar').style.display = 'flex';
    const name = user.displayName || user.email?.split('@')[0] || 'Usuario';
    document.getElementById('userName').textContent = name;
    const av = document.getElementById('userAvatar');
    if (user.photoURL) av.innerHTML = `<img src="${user.photoURL}">`;
    else av.textContent = name[0].toUpperCase();
    // Load data then show dashboard
    await loadPrefs();
    await loadExchangeKeys();
    await loadAll();
    setTimeout(() => window.checkMissedTradeLevels?.(), 1200);
    showPage('positions');
    startLivePrices();
    // Show master password modal if keys are configured
    setTimeout(checkMasterPassNeeded, 800);
    startAutoSync();
    // Railway is reached through the Cloudflare Worker for exchange sync.
    // Avoid a direct browser call here because Railway can reject CORS preflight.
  } else {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    trades = []; traders = [];
  }
});

// ── Prefs ──────────────────────────────────────────────────────────────────
async function loadPrefs() {
  try {
    const snap = await getDoc(doc(db, 'userPrefs', CU.uid));
    if (snap.exists() && snap.data().theme) applyTheme(snap.data().theme, false);
  } catch(e) {}
}
window.saveTheme = async theme => {
  try { await setDoc(doc(db,'userPrefs',CU.uid), {theme}, {merge:true}); } catch(e) {}
};

// ── Data loading ───────────────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadTrades(), loadTraders()]);
}

async function loadTrades() {
  try {
    const q    = query(collection(db,'trades'), where('userId','==',CU.uid));
    const snap = await getDocs(q);
    trades = [];
    snap.forEach(d => trades.push({ id: d.id, ...d.data() }));
    trades.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
  } catch(e) {
    console.error('loadTrades:', e);
    toast('Error cargando trades: ' + e.message, 'error');
  }
}

async function loadTraders() {
  try {
    const q    = query(collection(db,'traders'), where('userId','==',CU.uid));
    const snap = await getDocs(q);
    traders = [];
    snap.forEach(d => traders.push({ id: d.id, ...d.data() }));
    traders.sort((a,b) => (a.name||'').localeCompare(b.name||''));
    fillTraderDropdowns();
  } catch(e) {
    console.error('loadTraders:', e);
  }
}

function fillTraderDropdowns() {
  const opts = '<option value="">— Sin trader —</option>' +
    traders.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  ['cTrader','mTrader'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
  const filtEl = document.getElementById('filtTrader');
  if (filtEl) filtEl.innerHTML = '<option value="">Trader</option>' +
    traders.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
}

// ── Trades CRUD ────────────────────────────────────────────────────────────
let _savingTrade = false;
window.saveTrade = async status => {
  if (_savingTrade) return;
  _savingTrade = true;
  const ticker = document.getElementById('cTicker').value.trim().toUpperCase();
  const entry  = parseFloat(document.getElementById('cEntry').value) || 0;
  const sl     = parseFloat(document.getElementById('cSL').value) || 0;
  const risk   = parseFloat(document.getElementById('cRisk').value) || 0;
  const sizeInput = parseFloat(document.getElementById('cSize')?.value) || 0;
  const tp1    = parseFloat(document.getElementById('cTP1').value) || 0;
  const tp2    = parseFloat(document.getElementById('cTP2').value) || 0;
  const tp3    = parseFloat(document.getElementById('cTP3').value) || 0;
  const tp1pct = parseFloat(document.getElementById('cTP1pct').value) || 33;
  const tp2pct = parseFloat(document.getElementById('cTP2pct').value) || 33;
  const tp3pct = parseFloat(document.getElementById('cTP3pct').value) || 34;
  const traderId   = document.getElementById('cTrader').value;
  const traderName = traders.find(t=>t.id===traderId)?.name || '';
  const notes  = document.getElementById('cNotes').value;
  const invalidations = readInvalidationFields('c');

  if (!ticker || !entry) {
    toast('Completá ticker y entry como mínimo.','error'); _savingTrade = false; return;
  }
  const slDist  = sl ? Math.abs(sl - entry) / entry : 0;
  // Use manual size if provided, otherwise calculate from risk+SL
  const posSize = sizeInput > 0 ? sizeInput : (sl && risk ? (risk / slDist) : 0);
  const lev = calcState.dir === 'spot' ? 1 : (calcState.lev || 1);

  try {
    await addDoc(collection(db,'trades'), {
      userId: CU.uid, ticker, entry, sl, tp1, tp2, tp3,
      tp1pct, tp2pct, tp3pct, risk, posSize,
      dir: calcState.dir,
      exchange: calcState.dir === 'spot' ? 'spot' : calcState.ex,
      leverage: lev,
      traderId, traderName, notes, invalidations, status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await loadTrades();
    const dest = status==='watchlist' ? 'watchlist' : status==='pending' ? 'orders' : 'positions';
    const label = status==='watchlist' ? 'Watchlist' : status==='pending' ? 'Órdenes abiertas' : 'Posiciones';
    toast(`Guardado en ${label}!`);
    showPage(dest);
    if(dest==='orders') setTimeout(()=>window.syncAllOrders?.(), 300);
  } catch(e) {
    toast('Error al guardar: ' + e.message, 'error');
    console.error(e);
  } finally {
    _savingTrade = false;
  }
};

window.moveToActive = async id => {
  try {
    await updateDoc(doc(db,'trades',id), { status:'active', updatedAt: new Date().toISOString() });
    await loadTrades();
    renderWatchlist();
    toast('Trade movido a Posiciones.');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

let _dpDir = 'long';
window.setDPDir = dir => {
  _dpDir = dir;
  document.querySelectorAll('[data-dp]').forEach(b => {
    b.className = 'dir-btn' + (b.dataset.dp === dir ? ' al' : '');
  });
};

window.openDirectPositionModal = () => {
  _dpDir = 'long';
  document.querySelectorAll('[data-dp]').forEach(b => {
    b.className = 'dir-btn' + (b.dataset.dp === 'long' ? ' al' : '');
  });
  ['dpTicker','dpSL','dpSize','dpRisk','dpTP1','dpTP2','dpTP3','dpNotes'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('dpLev').value = '1';
  document.getElementById('dpTP1pct').value = '33';
  document.getElementById('dpTP2pct').value = '33';
  document.getElementById('dpTP3pct').value = '34';
  document.getElementById('dpDate').value = new Date().toISOString().split('T')[0];
  const sel = document.getElementById('dpTrader');
  if (sel && window.G) {
    sel.innerHTML = '<option value="">— ninguno —</option>' +
      window.G.traders().map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  }
  openModal('directPositionModal');
};

window.saveDirectPosition = async () => {
  const ticker = document.getElementById('dpTicker').value.trim().toUpperCase();
  const entry  = parseFloat(document.getElementById('dpEntry').value) || 0;
  if (!ticker || !entry) { toast('Ingresá ticker y precio de entrada.','error'); return; }
  const exchange   = document.getElementById('dpExchange').value || 'MANUAL';
  const lev        = parseInt(document.getElementById('dpLev').value) || 1;
  const sl         = parseFloat(document.getElementById('dpSL').value) || 0;
  const size       = parseFloat(document.getElementById('dpSize').value) || 0;
  const risk       = parseFloat(document.getElementById('dpRisk').value) || 0;
  const tp1        = parseFloat(document.getElementById('dpTP1').value) || 0;
  const tp1pct     = parseFloat(document.getElementById('dpTP1pct').value) || 33;
  const tp2        = parseFloat(document.getElementById('dpTP2').value) || 0;
  const tp2pct     = parseFloat(document.getElementById('dpTP2pct').value) || 33;
  const tp3        = parseFloat(document.getElementById('dpTP3').value) || 0;
  const tp3pct     = parseFloat(document.getElementById('dpTP3pct').value) || 34;
  const traderId   = document.getElementById('dpTrader').value;
  const traderName = (window.G?.traders()||[]).find(t=>t.id===traderId)?.name||'';
  const date       = document.getElementById('dpDate').value;
  const notes      = document.getElementById('dpNotes').value;
  const slDist     = sl && entry ? Math.abs(sl-entry)/entry : 0;
  const posSize    = size > 0 ? size : (risk && slDist ? risk/slDist : 0);
  const calcRisk   = risk > 0 ? risk : (posSize && slDist ? Math.round(posSize*slDist*100)/100 : 0);
  try {
    await addDoc(collection(db,'trades'), {
      userId: CU.uid, ticker, dir: _dpDir, exchange, leverage: lev,
      entry, sl, tp1, tp1pct, tp2, tp2pct, tp3, tp3pct, posSize, risk: calcRisk,
      traderId, traderName, notes,
      status: 'active',
      createdAt: date ? date+'T00:00:00.000Z' : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await loadTrades();
    closeModal('directPositionModal');
    renderPositions();
    toast('Posición abierta.');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

window.openDirectTradeModal = () => {
  // Reset to "add" mode
  document.querySelector('#directTradeModal .modal-title').textContent = 'Agregar trade al historial';
  document.getElementById('dtSaveBtn').textContent = 'Guardar en historial';
  window._directTradeEditId = null;
  const G = window.G;
  const sel = document.getElementById('dtTrader');
  if (sel && G) {
    sel.innerHTML = '<option value="">— ninguno —</option>' +
      G.traders().map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  }
  document.getElementById('dtCloseDate').value = new Date().toISOString().split('T')[0];
  const pnlEl = document.getElementById('dtPnl');
  if (pnlEl) {
    pnlEl.value = '';
    pnlEl.dataset.manual = '';
    pnlEl.dataset.originalPnl = '';
  }
  window.updateDirectTradeSizeLabel?.();
  openModal('directTradeModal');
};

window._directTradeEditId = null;
window._saveDirectTrade = () => window.saveDirectTrade(window._directTradeEditId);

window.saveDirectTrade = async (editId) => {
  const ticker = document.getElementById('dtTicker').value.trim().toUpperCase();
  const dir    = document.getElementById('dtDir').value;
  const exchange = document.getElementById('dtExchange').value || 'MANUAL';
  const traderId   = document.getElementById('dtTrader').value;
  const traderName = (window.G?.traders()||[]).find(t=>t.id===traderId)?.name||'';
  const lev    = parseInt(document.getElementById('dtLev').value) || 1;
  const entry  = parseFloat(document.getElementById('dtEntry').value) || 0;
  const exit   = parseFloat(document.getElementById('dtExit').value) || 0;
  const marginInput = parseFloat(document.getElementById('dtSize').value) || 0;
  const notional = dir === 'spot' ? marginInput : marginInput * lev;
  const pnlEl = document.getElementById('dtPnl');
  const manualPnl = (pnlEl?.value || '').trim();
  const originalPnl = pnlEl?.dataset.originalPnl || '';
  const userTouchedPnl = pnlEl?.dataset.manual === '1' || (!editId && manualPnl !== '') || (editId && manualPnl !== '' && manualPnl !== originalPnl);
  const openDate  = document.getElementById('dtOpenDate').value;
  const closeDate = document.getElementById('dtCloseDate').value || new Date().toISOString().split('T')[0];
  const notes  = document.getElementById('dtNotes').value;

  if (!ticker) { toast('Ingresá el ticker.','error'); return; }
  if (!closeDate) { toast('Ingresá la fecha de cierre.','error'); return; }

  // Calculate PnL if not provided manually
  let pnl = userTouchedPnl ? parseFloat(manualPnl) : null;
  if (pnl == null && entry && exit && notional) {
    const sign = (dir==='short') ? -1 : 1;
    pnl = Math.round((notional/entry)*(exit-entry)*sign*100)/100;
  }
  const margin = dir==='spot' ? notional : marginInput;
  const pnlPct = pnl!=null && margin ? Math.round(pnl/margin*10000)/100 : 0;
  const days   = openDate ? Math.round((new Date(closeDate)-new Date(openDate))/86400000) : 0;

  try {
    const tradeData = {
      ticker, dir, exchange, leverage: lev, traderId, traderName,
      entry, closePrice: exit, posSize: notional, marginSize: margin,
      pnl: pnl || 0, pnlPct, daysOpen: days,
      status: 'closed',
      createdAt: openDate ? openDate+'T00:00:00.000Z' : new Date().toISOString(),
      closeDate, notes,
      updatedAt: new Date().toISOString(),
      source: 'manual_direct',
    };
    if (editId) {
      const {updateDoc, doc} = window._fb;
      await updateDoc(doc(db,'trades',editId), tradeData);
    } else {
      await addDoc(collection(db,'trades'), { ...tradeData, userId: CU.uid });
    }
    await loadTrades();
    closeModal('directTradeModal');
    // Reset title and button
    document.querySelector('#directTradeModal .modal-title').textContent = 'Agregar trade al historial';
    document.getElementById('dtSaveBtn').textContent = 'Guardar en historial';
    window._directTradeEditId = null;
    renderHistory();
    toast(editId ? 'Trade actualizado.' : 'Trade agregado al historial.');
    if (!editId) {
      ['dtTicker','dtExchange','dtEntry','dtExit','dtSize','dtPnl','dtNotes'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('dtLev').value = '1';
    }
  } catch(e) { toast('Error: '+e.message,'error'); }
};

function getTradeById(id) {
  return (window.G?.trades()||trades||[]).find(x => x.id === id);
}
function closedPartsForPosition(id) {
  return (window.G?.trades()||trades||[]).filter(x => x.partialClose && x.originalId === id && x.status === 'closed');
}
function positionOriginalSize(t) {
  const closed = closedPartsForPosition(t.id).reduce((s,x)=>s+(Number(x.posSize)||0),0);
  return Number(t.originalPosSize || t.initialPosSize || 0) || Math.round(((Number(t.posSize)||0) + closed)*100)/100;
}
function riskForSize(t, size) {
  const slDist = t.sl && t.entry ? Math.abs(t.sl - t.entry) / t.entry : 0;
  return slDist && size ? Math.round(size * slDist * 100) / 100 : 0;
}
function pnlForClose(t, closeSize, closePrice) {
  const sign = (t.dir === 'short') ? -1 : 1;
  return Math.round((closeSize / t.entry) * (closePrice - t.entry) * sign * 100) / 100;
}
const CLOSE_GOOD_TAGS = [
  'Respete plan','Buena entrada','Espere confirmacion','Buena paciencia','Tome parciales',
  'Movi SL correctamente','Cerre por invalidacion','Buen cierre manual','Buen tamano','Evite sobreoperar'
];
const CLOSE_ERROR_GROUPS = [
  { title:'Errores de entrada', tags:['FOMO','Entre tarde','Entre sin confirmacion','Mala lectura de contexto','Trade sin tesis','Persegui precio','Entre contra tendencia'] },
  { title:'Errores de gestion', tags:['Cerre temprano','No tome parcial','Movi SL mal','No respete SL','Deje volver ganancia','No movi SL a BE','Movi SL a BE demasiado pronto'] },
  { title:'Riesgo / disciplina', tags:['Sobreapalancamiento','Tamano excesivo','Risk mayor al plan','Revenge trade','Sobreoperacion','No estaba atento'] },
  { title:'Salida', tags:['Salida tardia','Salida impulsiva','Cierre emocional','Cierre tecnico correcto','Segui despues de invalidacion'] },
];
function plannedRForTrade(t) {
  const entry = Number(t?.entry) || 0;
  const sl = Number(t?.sl) || 0;
  const tp = Number(t?.tp1 || t?.tp2 || t?.tp3) || 0;
  if (!entry || !sl || !tp || entry === sl) return 0;
  return Math.abs((tp - entry) / (entry - sl));
}
function suggestedCloseTags(t) {
  const tags = [];
  if (!Number(t?.sl)) tags.push('Sin SL');
  if (!['tp1','tp2','tp3'].some(k => Number(t?.[k]))) tags.push('Sin TP');
  const lev = Number(t?.leverage) || 1;
  if (lev > 20) tags.push('Over leverage');
  else if (lev > 10) tags.push('Leverage alto');
  const rr = plannedRForTrade(t);
  if (Number(t?.sl) && ['tp1','tp2','tp3'].some(k => Number(t?.[k])) && rr && rr < 1) tags.push('RR flojo');
  if (tradeInvalidations(t).some(inv => t?.levelAlerts?.[inv.key])) tags.push('Tesis invalidada');
  if (!String(t?.notes || '').trim()) tags.push('Sin notas');
  return [...new Set(tags)];
}
function toggleCloseReviewTag(btn) {
  btn.classList.toggle('selected');
}
window.toggleCloseReviewTag = toggleCloseReviewTag;
function renderCloseReviewTags(t) {
  const el = document.getElementById('closeReviewTags');
  if (!el) return;
  const suggested = suggestedCloseTags(t);
  const chip = (tag, kind, selected=false) =>
    `<button type="button" class="review-chip ${kind} ${selected?'selected':''}" data-close-review-tag="${tag}" data-close-review-kind="${kind}" onclick="toggleCloseReviewTag(this)">${tag}</button>`;
  const row = (title, hint, html) => `<div style="margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <span class="lbl" style="margin:0;">${title}</span>
      <span class="info-dot" data-tip="${String(hint).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}" title="${hint}">i</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${html}</div>
  </div>`;
  el.innerHTML = `
    <div style="border:0.5px solid var(--border2);border-radius:var(--r);padding:10px 12px;background:rgba(255,255,255,0.015);">
      ${row('Sugeridos por MAUex', 'Tags que MAUex detecta automaticamente con los datos actuales del trade. Podes quitarlos si no aplican.', suggested.length ? suggested.map(x=>chip(x,'warn',true)).join('') : '<span style="font-size:11px;color:var(--t3);">Sin alertas automaticas.</span>')}
      ${row('Aciertos', 'Marca todo lo positivo que quieras recordar de este cierre.', CLOSE_GOOD_TAGS.map(x=>chip(x,'good')).join(''))}
      ${CLOSE_ERROR_GROUPS.map(group => row(group.title, 'Marca una o varias causas reales. Esto alimenta el Dashboard de calidad.', group.tags.map(x=>chip(x,'bad')).join(''))).join('')}
    </div>`;
}
function getCloseReviewData() {
  const selected = [...document.querySelectorAll('[data-close-review-tag].selected')];
  const byKind = kind => selected.filter(x => x.dataset.closeReviewKind === kind).map(x => x.dataset.closeReviewTag);
  const mauexTags = byKind('warn');
  const goodTags = byKind('good');
  const errorTags = byKind('bad');
  return {
    mauexTags, goodTags, errorTags,
    reviewTags: [...new Set([...mauexTags, ...goodTags, ...errorTags])],
    reviewedAt: new Date().toISOString(),
  };
}

window.openPartialClose = id => {
  window.openCloseTrade(id);
  document.getElementById('closePct').value = '50';
  document.getElementById('closeReason').value = 'manual';
  document.getElementById('closeNotes').value = 'Cierre parcial manual';
};

window.setCloseAction = key => {
  const action = window._closeChoices?.[key];
  if(!action) return;
  window._closeAction = action;
  document.getElementById('closePrice').value = action.price || '';
  const pctEl = document.getElementById('closePct');
  pctEl.value = action.pctRemaining;
  pctEl.dataset.closeSize = action.closeSize || '';
  pctEl.dataset.closeLevel = action.closeLevel || action.level || '';
  document.getElementById('closeReason').value = action.reason || 'manual';
  document.getElementById('closeNotes').value = action.notes || '';
  const btn = document.getElementById('closeConfirmBtn');
  if(btn) btn.textContent = action.button || 'Registrar cierre';
};

window.closeAtTP = (id, tpKey, tpPrice) => {
  window.openCloseTrade(id);
  setTimeout(() => window.setCloseAction(tpKey), 0);
};

window.openCloseTrade = id => {
  const t = getTradeById(id);
  if(!t){ toast('Trade no encontrado','error'); return; }
  const originalSize = positionOriginalSize(t);
  const closedParts = closedPartsForPosition(id);
  const closedSize = closedParts.reduce((s,x)=>s+(Number(x.posSize)||0),0);
  const realizedPnl = closedParts.reduce((s,x)=>s+(Number(x.pnl)||0),0);
  const remainingPct = originalSize ? Math.round((t.posSize/originalSize)*10000)/100 : 100;
  const price = window.G?.getPrice(t.ticker, t.dir) || '';
  window._closeId = id;
  window._closeChoices = {};
  window._closeAction = null;
  const closePctEl = document.getElementById('closePct');
  if(closePctEl) { closePctEl.dataset.closeSize = ''; closePctEl.dataset.closeLevel = ''; }

  document.getElementById('closeDate').value  = new Date().toISOString().split('T')[0];
  document.getElementById('closePrice').value = price || '';
  document.getElementById('closePct').value = '100';
  document.getElementById('closeReason').value = 'manual';
  document.getElementById('closeNotes').value = '';
  const btn = document.getElementById('closeConfirmBtn');
  if(btn) btn.textContent = 'Cerrar restante';

  const summary = document.getElementById('closeSummary');
  if(summary) summary.innerHTML = [
    '<strong>'+ (t.ticker||'') +' '+ String(t.dir||'').toUpperCase() +'</strong>',
    'Original: $'+fmt(originalSize),
    'Cerrado: $'+fmt(closedSize)+' ('+fmtP(originalSize ? closedSize/originalSize*100 : 0)+')',
    'Abierto: $'+fmt(t.posSize||0)+' ('+fmtP(remainingPct)+')',
    'PnL realizado: '+(realizedPnl>=0?'+':'-')+'$'+fmt(Math.abs(realizedPnl)),
    t.sl ? 'SL actual: $'+fmtPx(t.sl) : 'Sin SL actual',
  ].join('<br>');

  const makeAction = (key, label, opts) => {
    const closeSize = Math.min(Math.max(Number(opts.closeSize)||0, 0), Number(t.posSize)||0);
    const pctRemaining = t.posSize ? Math.round(closeSize / t.posSize * 10000) / 100 : 0;
    window._closeChoices[key] = {...opts, key, closeSize, pctRemaining};
    return `<button class="btn sm" style="text-align:left;padding:9px 10px;" onclick="window.setCloseAction('${key}')">${label}<br><span style="font-size:10px;color:var(--t3);">${pctRemaining}% del restante</span></button>`;
  };

  const closedLevels = new Set(['tp1','tp2','tp3','sl'].filter(level => isLevelConfirmed(t, level, closedParts)));
  const actions = [];
  const tpDefs = [{k:'tp1',l:'TP1',v:t.tp1,p:t.tp1pct||33},{k:'tp2',l:'TP2',v:t.tp2,p:t.tp2pct||33},{k:'tp3',l:'TP3',v:t.tp3,p:t.tp3pct||34}];
  tpDefs.forEach((tp, idx) => {
    if(!tp.v || closedLevels.has(tp.k)) return;
    const cascadeLevels = tpDefs.slice(0, idx + 1).filter(x => x.v && !closedLevels.has(x.k));
    const closeSize = cascadeLevels.reduce((sum, x) => sum + originalSize * (x.p/100), 0);
    const label = cascadeLevels.length > 1
      ? 'Cerrar hasta '+tp.l+' · incluye '+cascadeLevels.map(x=>x.l).join('+')
      : 'Cerrar '+tp.l+' · '+tp.p+'%';
    if(closeSize > 0 && t.posSize > 0) actions.push(makeAction(tp.k, label, {
      price: tp.v, reason:'tp', level:tp.k, closeLevel:tp.k,
      closeSize, cascadeLevels,
      notes: tp.l+' cerrado', button: cascadeLevels.length > 1 ? 'Cerrar hasta '+tp.l : 'Cerrar '+tp.l,
    }));
  });
  if(t.sl) actions.push(makeAction('sl', 'Cerrar por SL actual', {
    price:t.sl, reason:'sl', level:'sl', closeLevel:'sl', closeSize:t.posSize,
    notes:'Cierre por SL actual', button:'Cerrar por SL',
  }));
  actions.push(makeAction('remaining', 'Cerrar todo lo restante', {
    price:price || '', reason:'manual', level:'manual', closeLevel:'manual', closeSize:t.posSize,
    notes:'Cierre del restante', button:'Cerrar restante',
  }));
  actions.push(`<button class="btn sm" style="text-align:left;padding:9px 10px;" onclick="window._closeAction=null;document.getElementById('closePct').dataset.closeSize='';document.getElementById('closePct').dataset.closeLevel='';document.getElementById('closePct').value='50';document.getElementById('closeReason').value='manual';document.getElementById('closeNotes').value='Cierre parcial manual';document.getElementById('closeConfirmBtn').textContent='Cerrar parcial';">Cierre parcial manual<br><span style="font-size:10px;color:var(--t3);">Elegis % y precio</span></button>`);

  const quick = document.getElementById('closeQuickActions');
  if(quick) quick.innerHTML = actions.join('');
  renderCloseReviewTags(t);
  openModal('closeTradeModal');
};

window.confirmPartialClose = async () => {
  document.getElementById('closePrice').value = document.getElementById('partialPrice').value;
  document.getElementById('closePct').value = document.getElementById('partialPct').value;
  document.getElementById('closeDate').value = document.getElementById('partialDate').value;
  document.getElementById('closeNotes').value = document.getElementById('partialNotes').value || 'Cierre parcial manual';
  window._closeAction = null;
  await window.confirmClose();
  closeModal('partialCloseModal');
};

async function confirmCascadeClose(t, action, closeDate, closeNotes) {
  const originalSize = positionOriginalSize(t);
  const closeDateSafe = closeDate || new Date().toISOString().split('T')[0];
  const reviewData = getCloseReviewData();
  let remaining = Number(t.posSize)||0;
  let totalClosed = 0;
  let totalPnl = 0;
  let lastPrice = 0;
  let lastLevel = '';
  const updates = { originalPosSize: originalSize, updatedAt: new Date().toISOString() };
  const {addDoc, collection, updateDoc, doc, db} = window._fb;

  for (const level of action.cascadeLevels || []) {
    if(!level?.v || remaining <= 0) continue;
    const targetSize = Math.round(originalSize * ((Number(level.p)||0)/100) * 100) / 100;
    const closeSize = Math.min(targetSize, remaining);
    if(closeSize <= 0) continue;
    const closePrice = Number(level.v);
    const pnl = pnlForClose(t, closeSize, closePrice);
    const margin = t.dir==='spot' ? closeSize : closeSize/(t.leverage||1);
    const pctOriginal = originalSize ? Math.round(closeSize/originalSize*10000)/100 : 0;
    const levelClosure = { closedAt: closeDateSafe, closePrice, closePctOriginal: pctOriginal, pnl, posSize: closeSize, reason:'tp' };
    const closeData = {
      ticker: t.ticker, dir: t.dir, exchange: t.exchange,
      leverage: t.leverage, traderId: t.traderId, traderName: t.traderName,
      entry: t.entry, sl: t.sl, tp1: t.tp1, tp1pct: t.tp1pct, tp2: t.tp2, tp2pct: t.tp2pct, tp3: t.tp3, tp3pct: t.tp3pct,
      posSize: closeSize, originalPosSize: originalSize, risk: riskForSize(t, closeSize),
      status: 'closed', closePrice, closeDate: closeDateSafe, closeNotes: level.l+' cerrado',
      closeReason:'tp', closeLevel: level.k, closePctOriginal: pctOriginal,
      ...reviewData,
      pnl, pnlPct: Math.round(pnl/(margin||1)*10000)/100,
      daysOpen: Math.round((new Date(closeDateSafe) - new Date(t.createdAt)) / 86400000),
      createdAt: t.createdAt, updatedAt: new Date().toISOString(),
    };
    await addDoc(collection(db,'trades'), { ...closeData, userId: CU.uid, partialClose: true, originalId: t.id });
    updates['levelClosures.'+level.k] = levelClosure;
    updates['levelAlerts.'+level.k+'.confirmed'] = true;
    updates['levelAlerts.'+level.k+'.confirmedAt'] = new Date().toISOString();
    remaining = Math.max(0, Math.round((remaining - closeSize) * 100) / 100);
    totalClosed += closeSize;
    totalPnl += pnl;
    lastPrice = closePrice;
    lastLevel = level.k;
  }

  if(!totalClosed){ toast('No hay tamaño abierto para cerrar.','error'); return; }
  const isFullClose = remaining <= Math.max(0.01, (originalSize||0) * 0.0001);
  if(isFullClose) {
    await updateDoc(doc(db,'trades',t.id), {
      status:'closed_parent', posSize:0, risk:0,
      closePrice:lastPrice, closeDate: closeDateSafe, closeNotes:'Posicion cerrada por parciales',
      closeReason:'partial_sequence', closeLevel:lastLevel,
      ...reviewData,
      realizedPnl: Math.round(((Number(t.realizedPnl)||0) + totalPnl)*100)/100,
      ...updates,
    });
  } else {
    await updateDoc(doc(db,'trades',t.id), {
      posSize: remaining, risk: riskForSize(t, remaining),
      ...reviewData,
      realizedPnl: Math.round(((Number(t.realizedPnl)||0) + totalPnl)*100)/100,
      ...updates,
    });
  }
  await loadTrades();
  closeModal('closeTradeModal');
  toast('Cierre registrado. PnL: '+(totalPnl>=0?'+':'-')+'$'+fmt(Math.abs(totalPnl)), totalPnl>=0?'success':'error');
  renderPositions();
  renderHistory();
}

window.confirmClose = async () => {
  const id         = window._closeId;
  const closePrice = parseFloat(document.getElementById('closePrice').value) || 0;
  const closePct   = parseFloat(document.getElementById('closePct').value) || 100;
  const closeDate  = document.getElementById('closeDate').value;
  const closeReason = document.getElementById('closeReason').value || 'manual';
  const closeNotes = document.getElementById('closeNotes').value;
  if (!closePrice) { toast('Ingresa el precio de salida.','error'); return; }
  if (closePct <= 0 || closePct > 100) { toast('El % debe ser entre 1 y 100.','error'); return; }
  const t = getTradeById(id);
  if (!t) return;

  const originalSize = positionOriginalSize(t);
  const action = window._closeAction;
  if (action?.cascadeLevels?.length) return await confirmCascadeClose(t, action, closeDate, closeNotes);
  const closePctEl = document.getElementById('closePct');
  const selectedCloseSize = parseFloat(closePctEl?.dataset.closeSize || '') || 0;
  let closeSize = selectedCloseSize || (action?.closeSize ? Number(action.closeSize) : Math.round((Number(t.posSize)||0) * closePct) / 100);
  closeSize = Math.min(Math.max(closeSize, 0), Number(t.posSize)||0);
  if(!closeSize){ toast('No hay tamaño abierto para cerrar.','error'); return; }
  const remainSize = Math.max(0, Math.round(((Number(t.posSize)||0) - closeSize) * 100) / 100);
  const isFullClose = remainSize <= Math.max(0.01, (originalSize||0) * 0.0001);
  const pnl = pnlForClose(t, closeSize, closePrice);
  const margin = t.dir==='spot' ? closeSize : closeSize/(t.leverage||1);
  const days = Math.round((new Date(closeDate) - new Date(t.createdAt)) / 86400000);
  const closeLevel = action?.closeLevel || closePctEl?.dataset.closeLevel || (closeReason === 'sl' ? 'sl' : closeReason === 'tp' ? 'tp' : 'manual');
  const pctOriginal = originalSize ? Math.round(closeSize/originalSize*10000)/100 : closePct;
  const note = closeNotes || (closeReason === 'tp' ? 'Take profit' : closeReason === 'sl' ? 'Stop loss' : (isFullClose ? 'Cierre del restante' : 'Cierre parcial manual'));
  const reviewData = getCloseReviewData();
  const isStructuredLevelClose = ['tp1','tp2','tp3','sl'].includes(closeLevel);
  const levelClosure = isStructuredLevelClose ? {
    closedAt: closeDate,
    closePrice,
    closePctOriginal: pctOriginal,
    pnl,
    posSize: closeSize,
    reason: closeReason,
  } : null;
  const levelCloseUpdates = levelClosure ? {
    ['levelClosures.' + closeLevel]: levelClosure,
    ['levelAlerts.' + closeLevel + '.confirmed']: true,
    ['levelAlerts.' + closeLevel + '.confirmedAt']: new Date().toISOString(),
  } : {};

  try {
    const {addDoc, collection, updateDoc, doc, db} = window._fb;
    const closeData = {
      ticker: t.ticker, dir: t.dir, exchange: t.exchange,
      leverage: t.leverage, traderId: t.traderId, traderName: t.traderName,
      entry: t.entry, sl: t.sl, tp1: t.tp1, tp1pct: t.tp1pct, tp2: t.tp2, tp2pct: t.tp2pct, tp3: t.tp3, tp3pct: t.tp3pct,
      posSize: closeSize, originalPosSize: originalSize, risk: riskForSize(t, closeSize),
      status: 'closed', closePrice, closeDate, closeNotes: note,
      closeReason, closeLevel, closePctOriginal: pctOriginal,
      ...reviewData,
      pnl, pnlPct: Math.round(pnl/(margin||1)*10000)/100,
      daysOpen: days, createdAt: t.createdAt, updatedAt: new Date().toISOString(),
    };

    if (isFullClose && !closedPartsForPosition(id).length) {
      await updateDoc(doc(db,'trades',id), {
        ...closeData,
        status:'closed',
        posSize: closeSize,
        updatedAt: new Date().toISOString(),
      });
    } else if (isFullClose) {
      await addDoc(collection(db,'trades'), { ...closeData, userId: CU.uid, partialClose: true, originalId: id });
      await updateDoc(doc(db,'trades',id), {
        status:'closed_parent', posSize: 0, risk: 0, originalPosSize: originalSize,
        closePrice, closeDate, closeNotes:'Posicion cerrada por parciales',
        closeReason:'partial_sequence', updatedAt: new Date().toISOString(),
        ...reviewData,
        ...levelCloseUpdates,
      });
    } else {
      await addDoc(collection(db,'trades'), { ...closeData, userId: CU.uid, partialClose: true, originalId: id });
      await updateDoc(doc(db,'trades',id), {
        posSize: remainSize, risk: riskForSize(t, remainSize), originalPosSize: originalSize,
        ...reviewData,
        realizedPnl: Math.round(((Number(t.realizedPnl)||0) + pnl)*100)/100,
        updatedAt: new Date().toISOString(),
        ...levelCloseUpdates,
      });
    }

    await loadTrades();
    closeModal('closeTradeModal');
    toast('Cierre registrado. PnL: '+(pnl>=0?'+':'-')+'$'+fmt(Math.abs(pnl)), pnl>=0?'success':'error');
    renderPositions();
    renderHistory();
  } catch(e) { toast('Error: '+e.message,'error'); console.error(e); }
};

window.deleteTrade = async id => {
  if (!confirm('¿Eliminar este trade?')) return;
  try {
    await deleteDoc(doc(db,'trades',id));
    await loadTrades();
    // Re-render current visible page
    ['dashPage','watchPage','ordersPage','posPage','mapPage','histPage'].forEach(pid => {
      const el = document.getElementById(pid);
      if (el && el.style.display !== 'none') {
        const fn = {dashPage:renderDashboard,watchPage:renderWatchlist,ordersPage:renderOrders,posPage:renderPositions,mapPage:renderMap,histPage:renderHistory}[pid];
        if (fn) fn();
      }
    });
    toast('Trade eliminado.');
  } catch(e) { toast('Error: '+e.message,'error'); console.error(e); }
};

window.saveManualTrade = async () => {
  const ticker = document.getElementById('mTicker').value.trim().toUpperCase();
  if (!ticker) { toast('Ingresá el ticker.','error'); return; }
  // Collect entries
  const entryEls = document.querySelectorAll('[data-erow-price]');
  const entries = [];
  entryEls.forEach(el => {
    const price = parseFloat(el.value)||0;
    const sizeEl = document.getElementById('esize'+el.dataset.erowPrice);
    const size  = parseFloat(sizeEl?.value)||0;
    if (price>0 && size>0) entries.push({price,size});
  });
  if (!entries.length) { toast('Agregá al menos una entrada.','error'); return; }
  const totalSize = entries.reduce((s,e)=>s+e.size,0);
  const avgEntry  = entries.reduce((s,e)=>s+e.price*e.size,0) / totalSize;
  const sl        = parseFloat(document.getElementById('mSL').value)||0;
  const lev       = parseInt(document.getElementById('mLev').value)||1;
  const traderId  = document.getElementById('mTrader').value;
  const traderName= traders.find(t=>t.id===traderId)?.name||'';
  const slDist    = sl ? Math.abs(sl-avgEntry)/avgEntry : 0.05;
  const risk      = Math.round(totalSize*slDist*100)/100;
  const date      = document.getElementById('mDate').value;
  const invalidations = readInvalidationFields('m');
  try {
    await addDoc(collection(db,'trades'), {
      userId: CU.uid, ticker,
      dir: manualDir, exchange: document.getElementById('mExchange').value.trim().toUpperCase(),
      leverage: lev, traderId, traderName,
      entries, entry: Math.round(avgEntry*100)/100, posSize: totalSize, risk, sl,
      tp1: parseFloat(document.getElementById('mTP1').value)||0,
      tp2: parseFloat(document.getElementById('mTP2').value)||0,
      tp3: parseFloat(document.getElementById('mTP3').value)||0,
      notes: document.getElementById('mNotes').value,
      invalidations,
      status: 'active',
      createdAt: date ? date+'T00:00:00.000Z' : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await loadTrades();
    closeModal('manualTradeModal');
    toast(`Posición ${ticker} cargada!`);
    showPage('positions');
  } catch(e) { toast('Error: '+e.message,'error'); console.error(e); }
};

// ── Traders CRUD ───────────────────────────────────────────────────────────
window.openTraderModal = id => {
  window._editTId = id || null;
  document.getElementById('traderModalTitle').textContent = id ? 'Editar trader' : 'Agregar trader';
  if (id) {
    const t = traders.find(x=>x.id===id);
    document.getElementById('tName').value    = t?.name || '';
    document.getElementById('tChannel').value = t?.channel || '';
    document.getElementById('tNotes').value   = t?.notes || '';
  } else {
    ['tName','tChannel','tNotes'].forEach(i => document.getElementById(i).value='');
  }
  openModal('traderModal');
};

window.saveTrader = async () => {
  const name    = document.getElementById('tName').value.trim();
  const channel = document.getElementById('tChannel').value.trim();
  const notes   = document.getElementById('tNotes').value.trim();
  if (!name) { toast('Ingresá el nombre.','error'); return; }
  try {
    if (window._editTId) {
      await updateDoc(doc(db,'traders',window._editTId), {name,channel,notes});
    } else {
      await addDoc(collection(db,'traders'), {userId:CU.uid,name,channel,notes,createdAt:new Date().toISOString()});
    }
    await loadTraders();
    closeModal('traderModal');
    renderTraders();
    toast('Trader guardado.');
  } catch(e) { toast('Error: '+e.message,'error'); console.error(e); }
};

window.deleteTrader = async id => {
  if (!confirm('¿Eliminar trader?')) return;
  try {
    await deleteDoc(doc(db,'traders',id));
    await loadTraders();
    renderTraders();
    toast('Trader eliminado.');
  } catch(e) { toast('Error: '+e.message,'error'); }
};

// ── CSV Import ─────────────────────────────────────────────────────────────
window.importCSV = async () => {
  const file = document.getElementById('csvFile').files[0];
  if (!file) { toast('Seleccioná un archivo.','error'); return; }
  const text = await file.text();
  const rows = parseCSV(text);
  if (!rows.length) { toast('No se encontraron datos.','error'); return; }
  let count = 0;
  for (const row of rows) {
    try { await addDoc(collection(db,'trades'), {userId:CU.uid,...row}); count++; } catch(e) {}
  }
  await loadTrades();
  closeModal('importModal');
  renderDashboard();
  toast(`${count} trades importados.`);
};

function parseCSV(text) {
  const lines = text.split('\n'); const rows = []; let ticker = '';
  const TICKERS=['BTC','ETH','XMR','XRP','LINK','SOL','ONDO','ADA','DOT','AVAX','AAVE',
    'ATOM','ANKR','TRX','RSR','IOTA','AVA','AKRO','KAVA','OMG','MANA','WAXP','OVR','BLOK','VLX','KABY'];
  lines.forEach(line => {
    const c = line.split(',').map(x=>x.replace(/"/g,'').trim());
    const t5 = c[5]?.toUpperCase().replace(/\s*\d+\s*$/,'').replace(/USD$/,'').trim();
    if (t5 && TICKERS.includes(t5)) ticker = t5;
    const desc=c[7]||'', date=c[8]||'', exch=c[9]||'';
    const price=parseFloat(c[11]?.replace(/[$,]/g,'')), capital=parseFloat(c[12]?.replace(/[$,]/g,''));
    if (desc&&date&&date.match(/\d/)&&price&&capital&&ticker) {
      const isExit=/(EXIT|VENTA|LIQ)/i.test(desc);
      if (!isExit) {
        const dir=/(SHORT)/i.test(desc)?'short':/(LONG)/i.test(desc)?'long':'spot';
        const tm=desc.match(/(Dr\.Profit|TraderCash|Dr Profit)/i);
        const pd=date.split('/');
        const dt=pd.length===3?`${pd[2].length===4?pd[2]:'20'+pd[2]}-${pd[1].padStart(2,'0')}-${pd[0].padStart(2,'0')}`:date;
        rows.push({
          ticker, dir, exchange:exch.toUpperCase(), entry:price, sl:0,tp1:0,tp2:0,tp3:0,
          risk:Math.round(capital*0.05*100)/100, posSize:capital, leverage:1,
          traderName:tm?tm[0]:'', notes:desc, status:'closed',
          createdAt:dt+'T00:00:00.000Z', updatedAt:new Date().toISOString(),
        });
      }
    }
  });
  return rows.filter(r=>r.ticker&&r.entry>0);
}

// ── Live prices ────────────────────────────────────────────────────────────
const prices = {};  // prices[sym] = { spot: n, futures: n }
let wsMap = {};
let pollTimer = null;
let kucoinPollTimer = null;

const CRYPTOS = ['BTC','ETH','SOL','BNB','XRP','ADA','DOT','AVAX','MATIC','LINK','UNI',
  'ATOM','NEAR','FTM','ALGO','VET','MANA','SAND','AXS','DOGE','LTC','BCH','ETC','XLM',
  'TRX','IOTA','RSR','KAVA','OMG','WAXP','BLOK','VLX','AKRO','AAVE','ONDO','XMR','ANKR',
  'HYPE','CAKE','LINEA','XVG','POL','POLUSDT'];

const CRYPTO_EXCHANGES = ['BINANCE','BYBIT','OKX','MEXC','KUCOIN','GATE','KRAKEN','COINBASE','HUOBI'];

function isCrypto(ticker, exchange) {
  if (exchange && CRYPTO_EXCHANGES.includes((exchange||'').toUpperCase())) return true;
  const sym = (ticker||'').replace(/USDT|BUSD|USD$/,'').toUpperCase();
  return CRYPTOS.includes(sym) || (ticker||'').endsWith('USDT') || (ticker||'').endsWith('BUSD');
}
window.isCryptoTicker = isCrypto;

async function fetchYahooPrice(ticker) {
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

function setPrice(sym, type, price) {
  if (!prices[sym]) prices[sym] = {};
  prices[sym][type] = price;
  updatePriceEl(sym);
  updateTimestamp();
  checkPriceAlerts(sym, price);
}

// ── Price Alert System ────────────────────────────────────────────────────
const _alertState = {}; // { key: { count, silencedUntil, firedOnce } }

function _alertKey(id, type) { return `${id}_${type}`; }

function _shouldAlert(key, critical) {
  const now = Date.now();
  const s = _alertState[key] || { count:0, silencedUntil:0, firedOnce:false };
  if (s.silencedUntil && now < s.silencedUntil) return false;
  if (!critical && s.firedOnce) return false;
  return true;
}

function _recordAlert(key, critical) {
  const s = _alertState[key] || { count:0, silencedUntil:0, firedOnce:false };
  s.count++;
  s.firedOnce = true;
  if (critical && s.count >= 3) {
    s.silencedUntil = Date.now() + 5 * 60 * 1000; // silence 5min
    s.count = 0;
  }
  _alertState[key] = s;
}

function _resetAlert(key) {
  delete _alertState[key];
}

function _notify(title, body, critical) {
  // Browser notification
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico', silent: !critical });
  }
  // Toast
  toast(`${title}: ${body}`, critical ? 'error' : 'warning');
}

function checkPriceAlerts(sym, price) {
  if (!window.G || !window._loadTrades) return;
  const activeTrades = (window.G.trades()||[]);

  activeTrades.forEach(t => {
    if (!t.ticker) return;
    const tSym = t.ticker.replace(/USDT|BUSD|USD$/,'').toUpperCase();
    if (tSym !== sym) return;
    const entry = t.entry || 0;
    const sl    = t.sl || 0;
    const tp1   = t.tp1 || 0;
    const tp2   = t.tp2 || 0;
    const tp3   = t.tp3 || 0;
    const dir   = t.dir || 'long';
    const isLong = dir === 'long' || dir === 'spot';

    if (['watchlist','pending','active'].includes(t.status)) {
      tradeInvalidations(t).forEach(inv => {
        const key = _alertKey(t.id, inv.key + '_hit');
        const alreadyMarked = !!(t.levelAlerts?.[inv.key] || window.hasAlert?.(t.id, inv.key));
        if (!alreadyMarked && invalidationHit(inv, price) && _shouldAlert(key, false)) {
          _recordAlert(key, false);
          window.setAlert?.(t.id, inv.key, { price, source:'live' });
          _notify(`${t.ticker} invalidacion tocada`, `Precio $${price.toFixed(4)} toco ${inv.label} $${inv.price}`, false);
          try { renderWatchlist?.(); renderOrders?.(); renderPositions?.(); } catch(e) {}
        }
      });
    }

    // ── ORDENES: precio toco el entry — UNA VEZ ──
    if (t.status === 'pending' && entry) {
      const key = _alertKey(t.id, 'entry_hit');
      const alreadyMarked = !!(t.levelAlerts?.entry || window.hasAlert?.(t.id, 'entry'));
      const hit = isLong ? price <= entry : price >= entry;
      if (hit && !alreadyMarked && _shouldAlert(key, false)) {
        _recordAlert(key, false);
        window.setAlert?.(t.id, 'entry', { price, source:'live' });
        _notify(`${t.ticker} Orden ejecutada`, `Precio $${price.toFixed(4)} toco el entry $${entry}`, false);
        try { renderOrders?.(); } catch(e) {}
      }
    }

    // ── POSICIONES ──
    if (t.status === 'active' && entry) {
      // SL tocado — UNA VEZ (no crítica para evitar loop)
      if (sl) {
        const slHit = isLong ? price <= sl : price >= sl;
        const slKey = _alertKey(t.id, 'sl_hit');
        if (slHit && _shouldAlert(slKey, false)) {
          _recordAlert(slKey, false);
          window.setAlert?.(t.id, 'sl', { price, source:'live' });
          _notify(`🛑 ${t.ticker} SL tocado`, `Precio ${price.toFixed(4)} tocó SL ${sl}`, false);
        }
      }

      // TP1 tocado — UNA VEZ
      if (tp1) {
        const tp1Hit = isLong ? price >= tp1 : price <= tp1;
        const tp1Key = _alertKey(t.id, 'tp1_hit');
        if (tp1Hit && _shouldAlert(tp1Key, false)) {
          _recordAlert(tp1Key, false);
          window.setAlert?.(t.id, 'tp1', { price, source:'live' });
          _notify(`🎯 ${t.ticker} TP1 alcanzado`, `Precio ${price.toFixed(4)} tocó TP1 ${tp1}`, false);
        }
      }

      // TP2 tocado — UNA VEZ
      if (tp2) {
        const tp2Hit = isLong ? price >= tp2 : price <= tp2;
        const tp2Key = _alertKey(t.id, 'tp2_hit');
        if (tp2Hit && _shouldAlert(tp2Key, false)) {
          _recordAlert(tp2Key, false);
          window.setAlert?.(t.id, 'tp2', { price, source:'live' });
          _notify(`🎯 ${t.ticker} TP2 alcanzado`, `Precio ${price.toFixed(4)} tocó TP2 ${tp2}`, false);
        }
      }

      // TP3 tocado — UNA VEZ
      if (tp3) {
        const tp3Hit = isLong ? price >= tp3 : price <= tp3;
        const tp3Key = _alertKey(t.id, 'tp3_hit');
        if (tp3Hit && _shouldAlert(tp3Key, false)) {
          _recordAlert(tp3Key, false);
          window.setAlert?.(t.id, 'tp3', { price, source:'live' });
          _notify(`🎯 ${t.ticker} TP3 alcanzado`, `Precio ${price.toFixed(4)} tocó TP3 ${tp3}`, false);
        }
      }
    }
  });
}

// Request notification permission on load
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  Notification.requestPermission();
}

function getPrice(ticker, dir) {
  if (!ticker) return null;
  const sym = ticker.replace(/USDT|BUSD|USD$/,'').toUpperCase();
  const p = prices[sym];
  if (!p) return null;
  if (sym === 'XMR') return p.spot || p.futures || null;
  return dir === 'spot' ? (p.spot || p.futures || null) : (p.futures || p.spot || null);
}
G.getPrice = getPrice;

function updatePriceEl(sym) {
  // Update price display elements
  document.querySelectorAll(`[data-px="${sym}"]`).forEach(el => {
    const dir = el.dataset.dir || 'spot';
    const p = getPrice(sym, dir);
    if (p != null) el.textContent = '$' + fmtPx(p);
  });

  // Update watchlist live price labels
  document.querySelectorAll(`[data-watchpx="${sym}"]`).forEach(el => {
    const dir = el.dataset.watchdir || 'futures';
    const p = getPrice(sym, dir);
    if (p != null) el.textContent = 'Actual: $' + fmtPx(p);
  });

  // Update watchlist price bars
  document.querySelectorAll(`[data-pricebar-sym="${sym}"]`).forEach(el => {
    const id  = el.dataset.pricebarId;
    const dir = el.dataset.pricebarDir || 'futures';
    const p   = getPrice(sym, dir);
    if (!p || !id) return;
    const G = window.G;
    const t = G?.trades?.()?.find(x => x.id === id);
    if (!t?.entry) return;
    const lev = t.leverage||1;
    const sg  = dir==='long'?1:-1;
    const liqApprox = t.entry * (1 - sg/lev*0.9);
    const fakeT = {...t, liquidation: t.liquidation||liqApprox};
    el.innerHTML = buildPriceBar(fakeT, p);
  });
  // NOTE: Exchange position PnL uses backend value (accounts for partials/mark price/funding)
  // Only update PnL for MANUAL positions (data-manual="true"), not exchange positions
  document.querySelectorAll(`[data-pnl="${sym}"][data-manual="true"]`).forEach(el => {
    const entry   = parseFloat(el.dataset.entry)||0;
    const posSize = parseFloat(el.dataset.pos)||0;
    const dir     = el.dataset.dir||'long';
    const p       = getPrice(sym, dir);
    if (!entry||!posSize||p==null) return;
    const pnl = Math.round((posSize/entry)*(entry-p)*(dir==='short'?1:-1)*100)/100;
    el.textContent = (pnl>=0?'+':'-')+'$'+Math.abs(pnl).toLocaleString('en-US',{maximumFractionDigits:0});
    el.className = el.className.replace(/pnl-pos|pnl-neg/g,'').trim() + (pnl>=0?' pnl-pos':' pnl-neg');
  });
  const mapPage = document.getElementById('mapPage');
  if (mapPage && mapPage.style.display !== 'none' && typeof window.renderMap === 'function') window.renderMap();
}

function updateTimestamp() {
  const el = document.getElementById('priceTime');
  if (el) el.textContent = 'En vivo · ' + new Date().toLocaleTimeString('es');
}

function startLivePrices() {
  // Include active, watchlist, pending AND zombie trades for live prices
  const relevant = trades.filter(t => t.status === 'active' || t.status === 'watchlist' || t.status === 'pending' || t.status === 'zombie');
  // Also include open exchange positions
  const posTickers = (window.exchangePositions||[]).map(p => p.ticker?.toUpperCase()).filter(Boolean);
  const cryptoSyms = [...new Set([
    ...relevant
      .filter(t => isCrypto(t.ticker, t.exchange))
      .map(t => t.ticker?.replace(/USDT|BUSD|USD$/,'').toUpperCase()),
    ...posTickers.map(t => t.replace(/USDT|BUSD|USD$/,'').toUpperCase()),
  ].filter(Boolean))];
  const stockTickers = [...new Set(relevant
    .filter(t => !isCrypto(t.ticker, t.exchange))
    .map(t => String(t.ticker || '').trim().toUpperCase())
    .filter(Boolean))];

  // Close old WS
  Object.values(wsMap).forEach(ws=>{ try{ws.close();}catch(e){} });
  wsMap = {};
  if (pollTimer) { clearInterval(pollTimer); pollTimer=null; }
  if (kucoinPollTimer) { clearInterval(kucoinPollTimer); kucoinPollTimer=null; }

  if (cryptoSyms.length) {
    // Binance SPOT
    try {
      const streams = cryptoSyms.map(s=>`${s.toLowerCase()}usdt@miniTicker`).join('/');
      const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      ws.onmessage = e => {
        try {
          const d = (JSON.parse(e.data).data || JSON.parse(e.data));
          if (d.s&&d.c) setPrice(d.s.replace('USDT',''), 'spot', parseFloat(d.c));
        } catch(err){}
      };
      ws.onclose = () => setTimeout(startLivePrices, 5000);
      wsMap['bnb-spot'] = ws;
    } catch(e){}

    // Binance FUTURES mark price
    try {
      const fstreams = cryptoSyms.map(s=>`${s.toLowerCase()}usdt@markPrice`).join('/');
      const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${fstreams}`);
      ws.onmessage = e => {
        try {
          const d = (JSON.parse(e.data).data || JSON.parse(e.data));
          if (d.s&&d.p) setPrice(d.s.replace('USDT',''), 'futures', parseFloat(d.p));
        } catch(err){}
      };
      wsMap['bnb-fut'] = ws;
    } catch(e){}

    // OKX SPOT
    try {
      const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
      ws.onopen = () => ws.send(JSON.stringify({op:'subscribe',args:cryptoSyms.map(s=>({channel:'tickers',instId:`${s}-USDT`}))}));
      ws.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          if (d.data?.[0]?.last) setPrice(d.data[0].instId.replace('-USDT',''), 'spot', parseFloat(d.data[0].last));
        } catch(err){}
      };
      const ping = setInterval(()=>{ if(ws.readyState===1) ws.send('ping'); }, 25000);
      ws.onclose = ()=>clearInterval(ping);
      wsMap['okx-spot'] = ws;
    } catch(e){}

    // OKX FUTURES
    try {
      const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
      ws.onopen = () => ws.send(JSON.stringify({op:'subscribe',args:cryptoSyms.map(s=>({channel:'mark-price',instId:`${s}-USDT-SWAP`}))}));
      ws.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          if (d.data?.[0]?.markPx) setPrice(d.data[0].instId.replace('-USDT-SWAP',''), 'futures', parseFloat(d.data[0].markPx));
        } catch(err){}
      };
      const ping = setInterval(()=>{ if(ws.readyState===1) ws.send('ping'); }, 25000);
      ws.onclose = ()=>clearInterval(ping);
      wsMap['okx-fut'] = ws;
    } catch(e){}

    // Bybit linear futures
    try {
      const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
      ws.onopen = () => ws.send(JSON.stringify({op:'subscribe',args:cryptoSyms.map(s=>`tickers.${s}USDT`)}));
      ws.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          if (d.topic&&d.data?.markPrice) setPrice(d.topic.replace('tickers.','').replace('USDT',''), 'futures', parseFloat(d.data.markPrice));
        } catch(err){}
      };
      wsMap['bybit-fut'] = ws;
    } catch(e){}
  }

  const kucoinSpotSyms = [...new Set(relevant
    .filter(t => (t.exchange||'').toUpperCase() === 'KUCOIN' || (t.ticker||'').replace(/USDT|BUSD|USD$/,'').toUpperCase() === 'XMR')
    .map(t => t.ticker?.replace(/USDT|BUSD|USD$/,'').toUpperCase())
    .filter(Boolean))];

  if (kucoinSpotSyms.length) {
    const fallbackUsdPrice = async (sym) => {
      if (sym === 'XMR') {
        try {
          const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd');
          const cd = await cg.json();
          const cp = Number(cd?.monero?.usd || 0);
          if (cp > 0) return cp;
        } catch(e) {}
        try {
          const kr = await fetch('https://api.kraken.com/0/public/Ticker?pair=XMRUSD');
          const kd = await kr.json();
          const kp = Number(kd?.result?.XXMRZUSD?.c?.[0] || kd?.result?.XMRUSD?.c?.[0] || 0);
          if (kp > 0) return kp;
        } catch(e) {}
      }
      return 0;
    };
    const pollKucoin = async () => {
      for (const sym of kucoinSpotSyms) {
        let p = 0;
        try {
          const url = `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym}-USDT`;
          const r = await (window.proxyFetch ? window.proxyFetch(url) : fetch(url));
          const d = await r.json();
          p = Number(d?.data?.price || 0);
        } catch(e) {}
        if (!p) p = await fallbackUsdPrice(sym);
        if (p > 0) setPrice(sym, 'spot', p);
      }
    };
    pollKucoin();
    kucoinPollTimer = setInterval(pollKucoin, 30000);
  }

  // Stocks/ETFs - poll every 30s
  if (stockTickers.length) {
    const poll = async () => {
      for (const t of stockTickers) {
        try {
          const p = await fetchYahooPrice(t);
          if (p > 0) setPrice(t, 'spot', p);
        } catch(e){}
      }
    };
    poll();
    pollTimer = setInterval(poll, 30000);
  }
}

window.refreshPricesManual = async () => {
  const relevant = trades.filter(t=>['active','pending','watchlist','zombie'].includes(t.status));
  for (const t of relevant) {
    const sym = t.ticker?.replace(/USDT|BUSD|USD$/,'').toUpperCase();
    if (!sym) continue;
    if (isCrypto(t.ticker, t.exchange)) {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
        const d = await r.json();
        if (d.price) setPrice(sym, 'spot', parseFloat(d.price));
      } catch(e){}
      try {
        const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}USDT`);
        const d = await r.json();
        if (d.markPrice) setPrice(sym, 'futures', parseFloat(d.markPrice));
      } catch(e){}
    } else {
      try {
        const p = await fetchYahooPrice(t.ticker);
        if (p > 0) setPrice(sym, 'spot', p);
      } catch(e){}
    }
  }
  renderPositions();
};

// Expose firebase internals for UI script
window._fb = { addDoc, collection, db, updateDoc, deleteDoc, deleteField, doc, setDoc, getDoc, getDocs, query, where };
window._getCU = () => CU;
window._loadTrades = loadTrades;
window._loadAll = loadAll;

// Expose startLivePrices so it can be called after adding a new trade
window.startLivePrices = startLivePrices;

// Expose exchange key helpers
G._hasExchangeKeys  = () => ['binance','bybit','okx','mexc','kucoin'].some(ex=>G._hasExchangeKey?.(ex));
G._hasExchangeKey   = ex => !!window._exchangeKeyStore?.[ex];
G._saveExchangeKey  = async (exchange, encrypted) => {
  window._exchangeKeyStore = window._exchangeKeyStore||{};
  window._exchangeKeyStore[exchange] = encrypted;
  await setDoc(doc(db,'userPrefs',CU.uid), {[`exkey_${exchange}`]: encrypted}, {merge:true});
};
G._getExchangeKey   = ex => window._exchangeKeyStore?.[ex];
G._saveTraderAssignment = async (exchangeId, traderId, traderName) => {
  // Save to a traderAssignments collection
  await setDoc(doc(db,'traderAssignments',CU.uid), {[exchangeId]:{traderId,traderName}}, {merge:true});
};

// Load exchange keys from Firestore on login
async function loadExchangeKeys() {
  try {
    const snap = await getDoc(doc(db,'userPrefs',CU.uid));
    if(snap.exists()) {
      const data = snap.data();
      window._exchangeKeyStore = {};
      ['binance','bybit','okx','mexc','kucoin'].forEach(ex=>{
        if(data[`exkey_${ex}`]) window._exchangeKeyStore[ex] = data[`exkey_${ex}`];
      });
    }
  } catch(e){}
}
// Expose prices for render functions
G.getPrice = getPrice;
G.prices   = prices;
