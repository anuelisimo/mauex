// Signal Desk: local inbox for Telegram-style signals
const SIGNAL_INBOX_KEY = 'mauex_signal_inbox_v1';
const SIGNAL_TELEGRAM_SECRET_KEY = 'mauex_telegram_inbox_secret';
const SIGNAL_FILTER_KEY = 'mauex_signal_filters_v1';
const SIGNAL_PARSE_VERSION = '2026-06-14-narrative-v2';
let _signalTelegramSyncing = false;
let _signalTelegramAutoTimer = null;
let _signalTelegramRunAgain = false;
let _signalRemoteStates = {};
const SIGNAL_STOPWORDS = new Set(['LONG','SHORT','SPOT','BUY','SELL','ENTRY','ENTRIES','ENTRADA','SL','STOP','LOSS','TP','TPS','TARGET','TARGETS','LEVERAGE','LEV','SIGNAL','SENAL','UPDATE','CLOSE','CLOSING','CERRAR','MOVE','MOVER','PRICE','PRECIO','USDT','USDC','USD','PERP','FUTURES','FUTUROS','BINANCE','BYBIT','OKX','MEXC','KUCOIN','VIP','FULLY','BOTTOMED','ACCUMULATION','BREAKOUT','CONFIRMED','EASY','SUPPORT','RESISTANCE','PROFIT','BREAKEVEN','MARKET','TAKING','TERM','DOWNSIDE','TURN','LOOKING','KILLA','DIGILEAK','DIGI','LEAK','DIGILEAKBOT','TRADER','GAUL']);

function signalEsc(v) {
  return esc(v);
}

function signalOriginalTime(sig={}) {
  return String(
    sig.signalTime ||
    sig.originalMessageDate ||
    sig.messageDate ||
    sig.sentAt ||
    sig.date ||
    sig.receivedAt ||
    sig.createdAt ||
    ''
  ).trim();
}

function signalHasOriginalTime(sig={}) {
  return !!signalOriginalTime(sig) && !sig.originalDateMissing;
}

function signalDateTimeText(raw='') {
  if (!raw) return 'Hora original pendiente';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('es-AR', {
    day:'2-digit',
    month:'2-digit',
    year:'2-digit',
    hour:'2-digit',
    minute:'2-digit'
  });
}

function signalDateTimeInputValue(raw='') {
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseSignalManualDateTime(raw='') {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), 0);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const year = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
    const d = new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), 0);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function signalTimeUnix(sig={}) {
  const raw = signalOriginalTime(sig);
  if (!raw || sig.originalDateMissing) return 0;
  return dateLikeToUnix(raw);
}

function dateLikeToUnix(raw) {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw > 1000000000000 ? Math.floor(raw / 1000) : Math.floor(raw);
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 1000000000000 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function loadSignalInbox() {
  try { return normalizeSignalInbox(JSON.parse(localStorage.getItem(SIGNAL_INBOX_KEY) || '[]')); }
  catch(e) { return []; }
}

function saveSignalInbox(items) {
  localStorage.setItem(SIGNAL_INBOX_KEY, JSON.stringify(items.slice(0, 200)));
}

function signalNeedsReparse(sig={}) {
  if (!sig?.raw) return false;
  const status = String(sig.status || '').trim();
  if (['converted','discarded','cleared'].includes(status)) return false;
  if (sig.parserVersion !== SIGNAL_PARSE_VERSION) return true;
  const missing = sig.missing || [];
  const criticalMissing = missing.some(x => ['ticker','direccion','entry','SL','TP'].includes(x));
  return criticalMissing && /\b(SCALP|LONGS?|SHORTS?|ENTRY|AREA|ZONE|ZONA|TARGET|SUB|SL|STOP)\b/i.test(sig.raw || '');
}

function normalizeSignalInbox(items=[]) {
  let changed = false;
  const normalized = (Array.isArray(items) ? items : []).map(sig => {
    if (!signalNeedsReparse(sig)) return sig;
    try {
      const parsed = parseSignalMessage(sig.raw, {
        traderId: sig.traderId || '',
        traderName: sig.traderName || sig.sourceName || '',
        source: sig.source || 'telegram',
        sourceName: sig.sourceName || sig.traderName || '',
        telegramId: sig.telegramId || '',
        exchange: sig.parsed?.exchange || 'BINANCE',
      });
      if (!parsed.parsed.ticker && sig.parsed?.ticker) parsed.parsed.ticker = sig.parsed.ticker;
      changed = true;
      return {
        ...sig,
        parsed: parsed.parsed,
        missing: parsed.missing,
        warnings: parsed.warnings,
        confidence: parsed.confidence,
        rrFirst: parsed.rrFirst,
        rr: parsed.rr,
        status: parsed.missing.length ? 'review' : 'ready',
        parserVersion: SIGNAL_PARSE_VERSION,
      };
    } catch(e) {
      return { ...sig, parserVersion: SIGNAL_PARSE_VERSION };
    }
  });
  if (changed) {
    try { localStorage.setItem(SIGNAL_INBOX_KEY, JSON.stringify(normalized.slice(0, 200))); } catch(e) {}
  }
  return normalized;
}

function signalRemoteId(sig={}) {
  return String(sig.telegramId || sig.id || signalInboxKey(sig) || '').trim();
}

function applySignalRemoteStates(items=[]) {
  if (!_signalRemoteStates || !Object.keys(_signalRemoteStates).length) return items;
  items.forEach(sig => {
    const remote = _signalRemoteStates[signalRemoteId(sig)];
    if (!remote) return;
    ['status','convertedAt','convertedTo','discardedAt','clearedAt','reviewedAt','targetSelectionManual','signalTime','originalMessageDate','originalDateMissing','signalTimeManual'].forEach(k => {
      if (remote[k] !== undefined) sig[k] = remote[k];
    });
    if (Array.isArray(remote.selectedTargetIndexes)) sig.selectedTargetIndexes = remote.selectedTargetIndexes;
  });
  return items;
}

async function saveSignalStateRemoteAsync(sig={}, patch={}) {
  const id = signalRemoteId(sig);
  if (!id) return null;
  const state = { ...patch, id, telegramId: sig.telegramId || '', sourceName: sig.sourceName || sig.traderName || '', providerSignalId: sig.providerSignalId || sig.parsed?.providerSignalId || '' };
  _signalRemoteStates[id] = { ...(_signalRemoteStates[id] || {}), ...state };
  if (window._saveSignalState) await window._saveSignalState(id, state);
  return state;
}

function saveSignalStateRemote(sig={}, patch={}) {
  saveSignalStateRemoteAsync(sig, patch).catch(()=>{});
}

const SIGNAL_SUPPRESSED_STATUSES = new Set(['discarded','converted','cleared']);

function signalIsSuppressedStatus(status='') {
  return SIGNAL_SUPPRESSED_STATUSES.has(String(status || '').trim());
}

function pruneSignalInbox(items=[]) {
  return items.filter(sig => sig?.status !== 'cleared');
}

function signalRemoteStateForIncoming(msg={}) {
  const ids = [msg.telegramId, msg.id].map(x => String(x || '').trim()).filter(Boolean);
  for (const id of ids) {
    if (_signalRemoteStates[id]) return _signalRemoteStates[id];
  }
  return null;
}

function signalIsRemotelySuppressed(msg={}) {
  const remote = signalRemoteStateForIncoming(msg);
  return !!remote && signalIsSuppressedStatus(remote.status);
}

window.refreshSignalRemoteStates = async () => {
  if (!window._loadSignalStates) return;
  try {
    _signalRemoteStates = await window._loadSignalStates() || {};
    const items = pruneSignalInbox(applySignalRemoteStates(loadSignalInbox()));
    saveSignalInbox(items);
    if (currentVisiblePage() === 'signals') renderSignals();
    updateNavAlertBadges?.();
  } catch(e) {}
};

function signalFilters() {
  try { return { status:'open', channel:'all', ...(JSON.parse(localStorage.getItem(SIGNAL_FILTER_KEY) || '{}') || {}) }; }
  catch(e) { return { status:'open', channel:'all' }; }
}

function saveSignalFilters(next) {
  localStorage.setItem(SIGNAL_FILTER_KEY, JSON.stringify({ ...signalFilters(), ...(next || {}) }));
}

function currentVisiblePage() {
  return document.querySelector('.bnav-btn.active')?.dataset?.page || '';
}

function signalNormText(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}

function signalTraderIdFromSource(sourceName='') {
  const source = signalNormText(sourceName);
  if (!source) return '';
  const aliases = [
    ['binance killers', 'binance killer'],
    ['bitcoin bullets', 'bitcoin bullet'],
  ];
  const list = window.G?.traders?.() || [];
  let found = list.find(t => {
    const n = signalNormText(t.name);
    const c = signalNormText(t.channel);
    return n && (source.includes(n) || n.includes(source) || c && (source.includes(c) || c.includes(source)));
  });
  if (found) return found.id;
  const alias = aliases.find(row => row.some(a => source.includes(a)));
  if (!alias) return '';
  found = list.find(t => {
    const n = signalNormText(t.name + ' ' + (t.channel || ''));
    return alias.some(a => n.includes(a));
  });
  return found?.id || '';
}

function signalProviderSignalId(raw='') {
  const text = String(raw || '');
  const m = text.match(/\bSIGNAL\s*ID\s*[:#]?\s*#?\s*([A-Z0-9_-]+)/i)
    || text.match(/\bSIGNAL\s*[:#]\s*#?\s*([A-Z0-9_-]+)/i)
    || text.match(/\bID\s*[:#]\s*#?\s*([A-Z0-9_-]+)/i);
  return m ? String(m[1]).toUpperCase() : '';
}

function signalInboxKey(sig={}) {
  const p = sig.parsed || {};
  const provider = signalNormText(sig.sourceName || sig.traderName || sig.source || '');
  const signalId = String(sig.providerSignalId || p.providerSignalId || '').toUpperCase();
  if (signalId) return `${provider || 'telegram'}:${signalId}`;
  return '';
}

function signalIsManagementUpdate(sig={}) {
  const p = sig.parsed || {};
  const raw = String(sig.raw || '');
  if (p.type !== 'update_or_management') return false;
  return /\b(UPDATE|TARGET\s*\d+\s*(?:HIT|TOC|✅)|TP\s*\d+\s*(?:HIT|TOC|✅)|CLOSING|CLOSED|CLOSE|BREAKEVEN|BREAK\s*EVEN|MOVE\s+SL|MOVER\s+SL|TRAIL|CANCEL|CANCELAR|STOP\s*HIT|SL\s*HIT)\b/i.test(raw);
}

function signalFindExistingSignalIndex(items=[], sig={}) {
  const p = sig.parsed || {};
  const signalId = String(sig.providerSignalId || p.providerSignalId || '').toUpperCase();
  const provider = signalNormText(sig.sourceName || sig.traderName || sig.source || '');
  const ticker = String(p.ticker || '').toUpperCase();
  const isLooseUpdate = !signalId && ticker && signalIsManagementUpdate(sig);
  if (!signalId && !isLooseUpdate) return -1;
  return items.findIndex(item => {
    if (!item || signalIsSuppressedStatus(item.status)) return false;
    const ip = item.parsed || {};
    const itemSignalId = String(item.providerSignalId || ip.providerSignalId || '').toUpperCase();
    const itemTicker = String(ip.ticker || '').toUpperCase();
    if (signalId && itemSignalId !== signalId) return false;
    if (isLooseUpdate && itemTicker !== ticker) return false;
    const itemProvider = signalNormText(item.sourceName || item.traderName || item.source || '');
    if (!provider || !itemProvider) return true;
    return provider === itemProvider || provider.includes(itemProvider) || itemProvider.includes(provider);
  });
}

function signalMergeUpdateIntoBase(base, update) {
  const updates = Array.isArray(base.updates) ? base.updates : [];
  const updateId = update.telegramId || update.id || `${Date.now()}`;
  if (!updates.some(x => x.id === updateId)) {
    updates.push({
      id: updateId,
      raw: update.raw || '',
      createdAt: update.createdAt || new Date().toISOString(),
      confidence: update.confidence || 0,
    });
  }
  base.updates = updates.slice(-20);
  base.lastTelegramUpdateAt = update.createdAt || new Date().toISOString();
  base.warnings = [...new Set([...(base.warnings || []), 'Update de Telegram recibido'])];
  base.telegramId = base.telegramId || update.telegramId || '';
  if (update.providerSignalId && !base.providerSignalId) base.providerSignalId = update.providerSignalId;
  return base;
}

function signalParseNumber(token) {
  if (!token) return 0;
  let s = String(token).trim().replace(/\$/g,'').replace(/\s/g,'');
  const hasK = /k$/i.test(s);
  s = s.replace(/k$/i,'');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g,'');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g,'');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n * (hasK ? 1000 : 1) : 0;
}

function signalNumbersFromText(text) {
  const clean = String(text || '')
    .replace(/\(\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*x\s*\)/ig,' ')
    .replace(/\b\d{1,3}\s*x\b/ig,' ')
    .replace(/\bx\s*\d{1,3}\b/ig,' ')
    .replace(/\bsignal\s*id\s*[:#]?\s*\d+\b/ig,' ')
    .replace(/#\d+\b/g,' ')
    .replace(/\d+(?:[.,]\d+)?\s*%/g,' ');
  return (clean.match(/\$?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*[kK]?/g) || [])
    .map(signalParseNumber)
    .filter(n => Number.isFinite(n) && n > 0);
}

function signalNarrativeNumbers(text) {
  const raw = String(text || '');
  const hasK = /\d(?:[.,]\d+)?\s*[kK]\b/.test(raw);
  return signalNumbersFromText(raw).map(n => hasK && n > 0 && n < 1000 ? n * 1000 : n);
}

function signalNarrativeRange(raw) {
  const text = String(raw || '');
  const re = /(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*[kK]?\s*(?:-|to)\s*(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*[kK]?/ig;
  let m;
  while ((m = re.exec(text))) {
    const context = text.slice(Math.max(0, m.index - 90), Math.min(text.length, m.index + m[0].length + 120));
    if (/\b(TARGETS?|TP|STOP|STOP\s*LOSS|SL)\b/i.test(context)) continue;
    if (/\b(ENTRY|ENTRADA|ZONE|ZONA|AREA|SCALP|LONGS?|SHORTS?|BUY|SELL|WAIT|SWEEP)\b/i.test(context)) {
      const nums = signalNarrativeNumbers(m[0]).slice(0, 2);
      if (nums.length >= 2) return nums;
    }
  }
  return [];
}

function signalNarrativeSingleLevel(raw, wordsRe) {
  const text = String(raw || '');
  const re = new RegExp(`(?:${wordsRe})[^\\n.]{0,100}?((?:\\d+(?:[.,]\\d+)?|[.,]\\d+)\\s*[kK]?)`, 'i');
  const m = text.match(re);
  const nums = m ? signalNarrativeNumbers(m[0]) : [];
  return nums[0] || 0;
}

function signalDetectTicker(raw) {
  const upper = String(raw || '').toUpperCase();
  const lines = upper.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\bSIGNAL\s*ID\b/.test(line)) continue;
    const newSignal = line.match(/\bNEW\s+SIGNAL\s*[-—:]\s*#?\$?\s*([A-Z0-9]{2,12})(?:\s*[-/]?\s*(USDT|USDC|USD|PERP))?/);
    if (newSignal && !SIGNAL_STOPWORDS.has(newSignal[1])) return newSignal[1].replace(/USDT|USDC|USD|PERP/g,'');
    const coin = line.match(/\bCOIN\s*:\s*#?\$?\s*([A-Z0-9]{2,12})(?:\s*[-/]?\s*(USDT|USDC|USD|PERP))?/);
    if (coin && !SIGNAL_STOPWORDS.has(coin[1])) return coin[1].replace(/USDT|USDC|USD|PERP/g,'');
  }
  for (const line of lines.slice(0, 8)) {
    if (/\bSIGNAL\s*ID\b/.test(line)) continue;
    const hash = line.match(/[$#]([A-Z][A-Z0-9]{1,11})\b/);
    if (hash && !SIGNAL_STOPWORDS.has(hash[1]) && !/^B?\d+$/.test(hash[1])) return hash[1];
  }
  const pair = upper.match(/\b([A-Z0-9]{2,12})\s*[-/]?\s*(USDT|USDC|USD|PERP)\b/);
  if (pair && !SIGNAL_STOPWORDS.has(pair[1])) return pair[1].replace(/PERP$/,'');
  for (const c of APP_CRYPTOS) {
    const re = new RegExp(`(?:#|\\$|\\b)${c}(?:USDT|USDC|USD|PERP)?\\b`, 'i');
    if (re.test(upper)) return c;
  }
  const tokens = upper.match(/\b[A-Z][A-Z0-9]{1,11}\b/g) || [];
  return (tokens.find(t => !SIGNAL_STOPWORDS.has(t) && !/^\d+$/.test(t)) || '').replace(/USDT|USDC|USD|PERP/g,'');
}

function signalDetectExchange(raw, fallback='BINANCE') {
  const upper = String(raw || '').toUpperCase();
  const found = ['BINANCE','BYBIT','OKX','MEXC','KUCOIN','IBKR','MANUAL'].find(ex => upper.includes(ex));
  return found || String(fallback || 'BINANCE').toUpperCase();
}

function signalDetectDirection(raw) {
  const upper = String(raw || '').toUpperCase();
  if (/\b(SCALP\s+SHORTS?|LIMIT\s+SHORT|SHORT\s+SETUP|SHORTING\s+SETUP|SELLING\s+SETUP|SELL\s+SETUP|SHORTS?)\b/.test(upper)) return 'short';
  if (/\b(SCALP\s+LONGS?|LIMIT\s+LONG|LONG\s+SETUP|BUYING\s+SETUP|BUY\s+SETUP|LONGS?)\b/.test(upper)) return 'long';
  if (/\bSPOT\b/.test(upper)) return 'spot';
  if (/\b(SHORT|SELL|VENTA|BAJISTA)\b/.test(upper)) return 'short';
  if (/\b(LONG|BUY|COMPRA|ALCISTA)\b/.test(upper)) return 'long';
  if (/\b(BULLISH|BOTTOMED|ACCUMULATION|BREAKOUT|SUPPORT|UPTREND|BOUNCE)\b/.test(upper)) return 'long';
  if (/\b(BEARISH|BREAKDOWN|DOWNTREND|RESISTANCE|REJECTION)\b/.test(upper)) return 'short';
  return '';
}

function signalLineHas(line, words) {
  const upper = String(line || '').toUpperCase();
  return words.some(w => upper.includes(w));
}

function signalLineIsEntry(line) {
  const raw = String(line || '').trim().replace(/^[^\w$#]+/u, '');
  return /^(ENTRY|ENTRADA|ENTRIES|ZONE|ZONA|LIMIT|BUY LIMIT|SELL LIMIT)\b/i.test(raw)
    || /\b(ENTRY|ENTRADA|ENTRIES|ZONE|ZONA|LIMIT|BUY LIMIT|SELL LIMIT)\s*[:=]/i.test(raw);
}

function signalLineIsCmpEntry(line) {
  return signalLineIsEntry(line)
    && /\b(CMP|CURRENT\s*MARKET|MARKET\s*PRICE|MARKET|NOW|AHORA)\b/i.test(String(line || ''));
}

function signalLineIsStop(line) {
  const raw = String(line || '').trim().replace(/^[^\w$#]+/u, '');
  return /^(STOP\s*LOSS|STOP|SL|INVALIDATION|INVALIDACION)\b/i.test(raw)
    || /\b(STOP\s*LOSS|STOP|SL|INVALIDATION|INVALIDACION)\s*[:=]/i.test(raw);
}

function signalLineIsTarget(line) {
  const raw = String(line || '').trim().replace(/^[^\w$#]+/u, '');
  return /^(TP\s*\d*|TARGET|TARGETS|TAKE\s*PROFIT|OBJETIVO)\b/i.test(raw)
    || /\b(TP|TARGET|TARGETS|TAKE\s*PROFIT|OBJETIVO)\s*[:=]/i.test(raw);
}

function signalCurrentPriceFor(ticker, dir='long') {
  const sym = String(ticker || '').replace(/USDT|USDC|USD|PERP/ig,'').toUpperCase();
  const candidates = [sym, `${sym}USDT`, `${sym}USD`, `${sym}PERP`, String(ticker || '').toUpperCase()].filter(Boolean);
  for (const c of candidates) {
    const p = window.G?.getPrice?.(c, dir) || window.G?.getPrice?.(c, 'futures') || window.G?.getPrice?.(c, 'spot');
    if (Number(p) > 0) return Number(p);
    const row = window.G?.prices?.[c];
    const saved = Number(row?.spot || row?.futures || row?.price || 0);
    if (saved > 0) return saved;
  }
  return 0;
}

function signalChooseEntry(entryRange, ticker, dir, livePrice=0) {
  const entries = (entryRange || []).filter(n => Number(n) > 0);
  if (!entries.length) return 0;
  if (entries.length === 1) return entries[0];
  const price = Number(livePrice || 0) || signalCurrentPriceFor(ticker, dir);
  if (price) {
    const low = Math.min(...entries);
    const high = Math.max(...entries);
    if (price >= low && price <= high) return Math.round(price * 100000000) / 100000000;
    return price < low ? low : high;
  }
  return Math.round((entries.reduce((s,n)=>s+n,0) / entries.length) * 100000000) / 100000000;
}

function signalWeightedRR(parsed={}) {
  const entry = Number(parsed.entry || 0);
  const sl = Number(parsed.sl || 0);
  const targets = Array.isArray(parsed.targets) && parsed.targets.length
    ? parsed.targets.map(Number).filter(Boolean)
    : [parsed.tp1, parsed.tp2, parsed.tp3].map(Number).filter(Boolean);
  if (!entry || !sl || !targets.length || sl === entry) return null;
  const pcts = Array.isArray(parsed.targetPercents) && parsed.targetPercents.length
    ? parsed.targetPercents.map(Number)
    : targets.map((_, i) => i === targets.length - 1 ? 100 - Math.floor(100 / targets.length) * (targets.length - 1) : Math.floor(100 / targets.length));
  const risk = Math.abs(entry - sl);
  const weight = targets.reduce((s, _, i) => s + (Number(pcts[i]) || 0), 0);
  if (!risk || !weight) return null;
  return targets.reduce((s, tp, i) => s + Math.abs(tp - entry) / risk * (Number(pcts[i]) || 0), 0) / weight;
}

function signalTargetLooksValid(n, parsed={}) {
  const target = Number(n || 0);
  const entry = Number(parsed.entry || 0);
  if (!target || !entry) return target > 0;
  const ratio = target / entry;
  if (ratio <= 0.01 || ratio >= 100) return false;
  if (parsed.dir === 'long' && target <= entry) return false;
  if (parsed.dir === 'short' && target >= entry) return false;
  return true;
}

async function signalFetchCurrentPrice(ticker, exchange='BINANCE', dir='long') {
  const sym = String(ticker || '').replace(/USDT|USDC|USD|PERP/ig,'').toUpperCase();
  if (!sym) return 0;
  const local = signalCurrentPriceFor(sym, dir);
  if (local) return local;
  const isCrypto = appIsCryptoTicker(sym, exchange);
  try {
    let px = 0;
    if (isCrypto) {
      const urls = [
        `https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`,
        `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}USDT`,
        `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym}-USDT`,
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}USDT`,
      ];
      if (String(exchange || '').toUpperCase() === 'KUCOIN') {
        urls.unshift(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym}-USDT`);
      }
      for (const url of urls) {
        try {
          const useProxy = url.includes('api.kucoin.com') && window.proxyFetch;
          let r = await (useProxy ? window.proxyFetch(url) : fetch(url));
          if (!r.ok && window.proxyFetch && !useProxy) {
            r = await window.proxyFetch(url).catch(() => r);
          }
          const d = await r.json();
          px = Number(d?.price || d?.data?.price || d?.result?.list?.[0]?.lastPrice || 0);
          if (px) break;
        } catch(e) {}
      }
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
    } else {
      px = await fetchYahooSpotPrice(sym);
    }
    if (px && window.G?.prices) {
      window.G.prices[sym] = {
        ...(window.G.prices[sym] || {}),
        spot: px,
        ...(dir !== 'spot' ? { futures: px } : {}),
      };
    }
    return px || 0;
  } catch(e) {
    return 0;
  }
}

function signalMarketState(parsed={}, price=0) {
  const current = Number(price || 0);
  const entries = (parsed.entryRange || []).map(Number).filter(Boolean);
  const entry = Number(parsed.entry || 0);
  const sl = Number(parsed.sl || 0);
  const dir = String(parsed.dir || '').toLowerCase();
  if (!current || (!entries.length && !entry) || !dir) return null;
  const low = entries.length ? Math.min(...entries) : entry;
  const high = entries.length ? Math.max(...entries) : entry;
  const inZone = current >= low && current <= high;
  let state = { price: current, code: 'unknown', label: 'Precio leído', tone: 'blue', detail: '' };
  if (dir === 'short') {
    if (sl && current >= sl) state = { price: current, code:'invalidated', label:'SL tocado', tone:'red', detail:'El precio actual ya está arriba del SL del short.' };
    else if (current > high) state = { price: current, code:'active_against', label:'Activada en contra', tone:'amber', detail:'El precio ya pasó la entrada y está yendo contra el short.' };
    else if (inZone) state = { price: current, code:'in_entry', label:'En zona de entrada', tone:'green', detail:'El precio actual está dentro del rango de entrada.' };
    else if (current < low) state = { price: current, code:'missed_favor', label:'Entrada perdida a favor', tone:'blue', detail:'El precio ya se movió a favor del short desde la zona de entrada.' };
  } else {
    if (sl && current <= sl) state = { price: current, code:'invalidated', label:'SL tocado', tone:'red', detail:'El precio actual ya está debajo del SL del long.' };
    else if (current < low) state = { price: current, code:'active_against', label:'Activada en contra', tone:'amber', detail:'El precio ya pasó la entrada y está yendo contra el long.' };
    else if (inZone) state = { price: current, code:'in_entry', label:'En zona de entrada', tone:'green', detail:'El precio actual está dentro del rango de entrada.' };
    else if (current > high) state = { price: current, code:'missed_favor', label:'Entrada perdida a favor', tone:'blue', detail:'El precio ya se movió a favor del long desde la zona de entrada.' };
  }
  return state;
}

function signalApplyMarketState(sig, price=0) {
  const p = sig?.parsed || {};
  const current = Number(price || 0);
  if (current && p.entryIsCurrentMarket && !p.entry) {
    p.entry = Math.round(current * 100000000) / 100000000;
    p.entryRange = [p.entry];
  }
  if (current && p.entryRange?.length > 1) p.entry = signalChooseEntry(p.entryRange, p.ticker, p.dir, current);
  sig.market = signalMarketState(p, current);
  sig.rrFirst = p.sl && p.entry && p.tp1 ? Math.abs((p.tp1 - p.entry) / (p.sl - p.entry)) : null;
  sig.rr = signalWeightedRR(p);
  if (p.entry && Array.isArray(sig.missing)) sig.missing = sig.missing.filter(x => x !== 'entry');
  if (p.dir && Array.isArray(sig.missing)) sig.missing = sig.missing.filter(x => x !== 'direccion');
  if (p.ticker && Array.isArray(sig.missing)) sig.missing = sig.missing.filter(x => x !== 'ticker');
  if (p.sl && Array.isArray(sig.missing)) sig.missing = sig.missing.filter(x => x !== 'SL');
  if (p.tp1 && Array.isArray(sig.missing)) sig.missing = sig.missing.filter(x => x !== 'TP');
  sig.status = sig.missing?.length ? 'review' : (sig.status === 'converted' ? 'converted' : 'ready');
  sig.warnings = (sig.warnings || []).filter(x => !String(x).startsWith('Precio: ') && x !== 'Sin precio live');
  if (!current) sig.warnings.push('Sin precio live');
  if (sig.market) {
    if (sig.market.code === 'invalidated') {
      sig.status = 'review';
      sig.confidence = Math.min(Number(sig.confidence || 0), 40);
    } else if (sig.market.code === 'active_against') {
      sig.confidence = Math.min(Number(sig.confidence || 0), 72);
    } else if (sig.market.code === 'missed_favor') {
      sig.confidence = Math.min(Number(sig.confidence || 0), 78);
    }
  }
  return sig;
}

async function signalHydrateMarket(sig) {
  const p = sig?.parsed || {};
  if (!p.ticker) return sig;
  const price = await signalFetchCurrentPrice(p.ticker, p.exchange, p.dir);
  return signalApplyMarketState(sig, price);
}

function parseSignalMessage(raw, opts={}) {
  const text = String(raw || '').trim();
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const joined = lines.join('\n');
  const upper = joined.toUpperCase();
  const providerSignalId = signalProviderSignalId(joined);
  const parsed = {
    ticker: signalDetectTicker(joined),
    dir: signalDetectDirection(joined),
    exchange: signalDetectExchange(joined, opts.exchange || 'BINANCE'),
    leverage: 1,
    entry: 0, sl: 0, tp1: 0, tp2: 0, tp3: 0,
    entryRange: [], targets: [], targetPercents: [],
    entryIsCurrentMarket: false,
    providerSignalId,
    type: 'new_signal',
  };
  const levExplicitRange = upper.match(/\b(?:LEV|LEVERAGE|APALANCAMIENTO|MARGIN)\s*[:=]?\s*(\d{1,3})\s*-\s*(\d{1,3})\s*X?\b/);
  const levExplicit = upper.match(/\b(?:LEV|LEVERAGE|APALANCAMIENTO|MARGIN)\s*[:=]?\s*(\d{1,3})\s*X?\b/);
  const levRange = upper.match(/\(\s*(\d{1,3})\s*-\s*(\d{1,3})\s*X\s*\)/) || upper.match(/\b(\d{1,3})\s*-\s*(\d{1,3})\s*X\b/);
  const levMatch = upper.match(/\bX\s*(\d{1,3})\b/) || upper.match(/\b(\d{1,3})\s*X\b/);
  if (levExplicitRange) parsed.leverage = Math.max(1, Math.min(125, Number(levExplicitRange[2]) || Number(levExplicitRange[1]) || 1));
  else if (levExplicit) parsed.leverage = Math.max(1, Math.min(125, Number(levExplicit[1]) || 1));
  else if (levRange) parsed.leverage = Math.max(1, Math.min(125, Number(levRange[2]) || Number(levRange[1]) || 1));
  else if (levMatch) parsed.leverage = Math.max(1, Math.min(125, Number(levMatch[1]) || 1));
  if (/\b(MOVE|MOVER|TRAIL|UPDATE|ACTUALIZA|BE|BREAK\s*EVEN|BREAKEVEN|CANCEL|CANCELAR|CLOSE|CLOSING|CERRAR|CLOSED|TP\s*HIT|TOCO|TOCÓ)\b/i.test(joined)) parsed.type = 'update_or_management';

  const targetNums = [];
  lines.forEach(line => {
    const work = line.replace(/\bTP\s*\d+\b/ig,'TP').replace(/\bTARGET\s*\d+\b/ig,'TARGET').replace(/\bTAKE\s*PROFIT\s*\d+\b/ig,'TAKE PROFIT');
    const nums = signalNumbersFromText(work);
    if (!nums.length) return;
    if (signalLineIsCmpEntry(line)) {
      parsed.entryIsCurrentMarket = true;
    } else if (signalLineIsEntry(line)) {
      parsed.entryRange = nums.slice(0, 2);
      parsed.entry = signalChooseEntry(parsed.entryRange, parsed.ticker, parsed.dir);
    } else if (signalLineIsStop(line)) {
      parsed.sl = nums[0];
    } else if (signalLineIsTarget(line)) {
      targetNums.push(...nums);
    }
  });
  if (!parsed.entry) {
    const entryMatch = lines.map(line => String(line || '').match(/^(?:ENTRY|ENTRADA|ENTRIES|ZONE|ZONA|LIMIT|BUY LIMIT|SELL LIMIT)\s*[:=\.]?\s*([^\n]+)/i)).find(Boolean);
    if (entryMatch && /\b(CMP|CURRENT\s*MARKET|MARKET\s*PRICE|MARKET|NOW|AHORA)\b/i.test(entryMatch[1] || '')) {
      parsed.entryIsCurrentMarket = true;
    }
    const nums = entryMatch ? signalNumbersFromText(entryMatch[1]) : [];
    if (nums.length) {
      parsed.entryRange = nums.slice(0, 2);
      parsed.entry = signalChooseEntry(parsed.entryRange, parsed.ticker, parsed.dir);
    }
  }
  if (!parsed.entry) {
    const narrativeRange = signalNarrativeRange(joined);
    if (narrativeRange.length >= 2) {
      parsed.entryRange = narrativeRange;
      parsed.entry = signalChooseEntry(parsed.entryRange, parsed.ticker, parsed.dir);
    }
  }
  if (!parsed.sl) {
    parsed.sl = signalNarrativeSingleLevel(joined, 'SL|STOP\\s*LOSS|STOP');
  }
  if (!targetNums.length) {
    const narrativeTarget = signalNarrativeSingleLevel(joined, 'TARGETS?|TAKE\\s*PROFIT|TP|SUB');
    if (narrativeTarget) targetNums.push(narrativeTarget);
  }
  const cleanTargets = [...new Set(targetNums)]
    .filter(n => !parsed.entry || Math.abs(n - parsed.entry) / Math.max(1, parsed.entry) > 0.001)
    .filter(n => signalTargetLooksValid(n, parsed))
    .slice(0, 12);
  parsed.targets = cleanTargets;
  const pct = cleanTargets.length ? Math.round((100 / cleanTargets.length) * 100) / 100 : 0;
  parsed.targetPercents = cleanTargets.map((_, i) => i === cleanTargets.length - 1 ? Math.round((100 - pct * (cleanTargets.length - 1)) * 100) / 100 : pct);
  [parsed.tp1, parsed.tp2, parsed.tp3] = [cleanTargets[0] || 0, cleanTargets[1] || 0, cleanTargets[2] || 0];
  if (!parsed.dir && parsed.entry && parsed.sl && cleanTargets.length) {
    const upTargets = cleanTargets.filter(x => x > parsed.entry).length;
    const downTargets = cleanTargets.filter(x => x < parsed.entry).length;
    if (parsed.sl < parsed.entry && upTargets >= Math.max(1, downTargets)) parsed.dir = 'long';
    else if (parsed.sl > parsed.entry && downTargets >= Math.max(1, upTargets)) parsed.dir = 'short';
  }
  if (providerSignalId && !parsed.entry && !parsed.sl && cleanTargets.length) parsed.type = 'update_or_management';
  if (parsed.entry && parsed.sl && cleanTargets.length && /\b(SCALP|LONGS?|SHORTS?|ENTRY|AREA|ZONE|ZONA|TARGET|SL|STOP)\b/i.test(joined)) parsed.type = 'new_signal';

  const missing = [];
  if (!parsed.ticker) missing.push('ticker');
  if (!parsed.dir) missing.push('direccion');
  if (!parsed.entry) missing.push('entry');
  if (!parsed.sl) missing.push('SL');
  if (!parsed.tp1) missing.push('TP');
  const warnings = [];
  if (parsed.type !== 'new_signal') warnings.push('Parece update, no señal nueva');
  if (parsed.dir === 'long' && parsed.sl && parsed.entry && parsed.sl >= parsed.entry) warnings.push('SL raro para LONG');
  if (parsed.dir === 'short' && parsed.sl && parsed.entry && parsed.sl <= parsed.entry) warnings.push('SL raro para SHORT');
  if (parsed.entryRange.length > 1) warnings.push('Entry operativo elegido dentro del rango');
  const confidence = Math.max(5, Math.min(98, 100 - missing.length * 16 - warnings.length * 8));
  const rrFirst = parsed.sl && parsed.entry && parsed.tp1 ? Math.abs((parsed.tp1 - parsed.entry) / (parsed.sl - parsed.entry)) : null;
  const rr = signalWeightedRR(parsed);
  const trader = (window.G?.traders?.() || []).find(t => t.id === opts.traderId);
  return {
    id: `sig-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    raw: text,
    createdAt: new Date().toISOString(),
    status: missing.length ? 'review' : 'ready',
    traderId: opts.traderId || '',
    traderName: trader?.name || opts.traderName || '',
    source: opts.source || '',
    sourceName: opts.sourceName || '',
    telegramId: opts.telegramId || '',
    providerSignalId,
    parsed,
    missing,
    warnings,
    confidence,
    rrFirst,
    rr,
    parserVersion: SIGNAL_PARSE_VERSION,
  };
}

function fillSignalTraderSelect() {
  const el = document.getElementById('signalTraderSelect');
  if (!el) return;
  const current = el.value;
  const list = window.G?.traders?.() || [];
  el.innerHTML = '<option value="">Sin trader</option>' + list.map(t => `<option value="${t.id}">${signalEsc(t.name)}</option>`).join('');
  if (current) el.value = current;
}

function renderSignalStats(items) {
  const el = document.getElementById('signalInboxStats');
  if (!el) return;
  el.innerHTML = '';
}

function signalChannelKey(sig={}) {
  const src = signalNormText(`${sig.sourceName || ''} ${sig.traderName || ''}`);
  if (/binance\s*killers/.test(src)) return 'binance';
  if (/bitcoin\s*bullets/.test(src)) return 'bullets';
  return 'other';
}

function signalStatusKey(sig={}) {
  if (sig.status === 'converted') return 'converted';
  if (sig.status === 'reviewed') return 'reviewed';
  if (sig.status === 'review') return 'review';
  if (sig.status === 'cleared') return 'discarded';
  if (sig.status === 'discarded') return 'discarded';
  return 'ready';
}

function signalMatchesFilters(sig={}, filters=signalFilters()) {
  const status = signalStatusKey(sig);
  if (filters.status === 'open' && ['converted','discarded'].includes(status)) return false;
  if (filters.status !== 'all' && filters.status !== 'open' && status !== filters.status) return false;
  if (filters.channel !== 'all' && signalChannelKey(sig) !== filters.channel) return false;
  return true;
}

function signalMatchesStatusFilter(sig={}, statusFilter='open') {
  const status = signalStatusKey(sig);
  if (statusFilter === 'open') return !['converted','discarded'].includes(status);
  if (statusFilter === 'all') return true;
  return status === statusFilter;
}

function signalMatchesChannelFilter(sig={}, channelFilter='all') {
  return channelFilter === 'all' || signalChannelKey(sig) === channelFilter;
}

function renderSignalFilters(items=[]) {
  const el = document.getElementById('signalFilters');
  if (!el) return;
  const filters = signalFilters();
  const statusCount = value => items.filter(x => signalMatchesStatusFilter(x, value) && signalMatchesChannelFilter(x, filters.channel)).length;
  const channelCount = value => items.filter(x => signalMatchesStatusFilter(x, filters.status) && signalMatchesChannelFilter(x, value)).length;
  const btn = (kind, value, label, count) => `<button class="signal-filter-btn ${filters[kind] === value ? 'active' : ''}" onclick="setSignalFilter('${kind}','${value}')">${label} (${count})</button>`;
  el.innerHTML = `
    <div class="signal-filter-group">
      ${btn('status','open','Abiertas', statusCount('open'))}
      ${btn('status','ready','Nuevas', statusCount('ready'))}
      ${btn('status','review','A revisar', statusCount('review'))}
      ${btn('status','reviewed','Revisadas', statusCount('reviewed'))}
      ${btn('status','converted','Convertidas', statusCount('converted'))}
      ${btn('status','discarded','Descartadas', statusCount('discarded'))}
      ${btn('status','all','Todas', statusCount('all'))}
    </div>
    <div class="signal-filter-group">
      ${btn('channel','all','Todos', channelCount('all'))}
      ${btn('channel','binance','Binance Killers', channelCount('binance'))}
      ${btn('channel','bullets','Bitcoin Bullets', channelCount('bullets'))}
    </div>`;
}

window.setSignalFilter = (kind, value) => {
  saveSignalFilters({ [kind]: value });
  renderSignals();
};

function signalFieldHtml(label, value, color, sub='') {
  return `<div class="signal-field"><span>${signalEsc(label)}</span><strong style="color:${color};">${value}</strong>${sub ? `<small>${signalEsc(sub)}</small>` : ''}</div>`;
}

function signalBestTargetLabel(parsed={}) {
  const targets = Array.isArray(parsed.targets) && parsed.targets.length
    ? parsed.targets
    : [parsed.tp1, parsed.tp2, parsed.tp3].filter(Boolean);
  if (!targets.length) return { value:'—', sub:'' };
  return {
    value: targets.length === 1 ? '$' + fmtPx(targets[0]) : String(targets.length),
    sub: targets.length === 1 ? 'TP1' : `TP1 $${fmtPx(targets[0])} · final $${fmtPx(targets[targets.length - 1])}`,
  };
}

function signalAllTargets(parsed={}) {
  return (Array.isArray(parsed.targets) && parsed.targets.length
    ? parsed.targets
    : [parsed.tp1, parsed.tp2, parsed.tp3]
  ).map(Number).filter(n => Number.isFinite(n) && n > 0);
}

function signalAutoTargetIndexes(targets=[]) {
  const n = targets.length;
  if (n <= 3) return targets.map((_, i) => i);
  return [...new Set([0, Math.round((n - 1) / 2), n - 1])].slice(0, 3);
}

function signalSelectedTargetIndexes(sig={}) {
  const targets = signalAllTargets(sig.parsed || {});
  const manual = Array.isArray(sig.selectedTargetIndexes) ? sig.selectedTargetIndexes : [];
  const cleaned = manual.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < targets.length).slice(0, 3);
  return sig.targetSelectionManual && cleaned.length ? cleaned : signalAutoTargetIndexes(targets);
}

function signalOperationalTargets(sig={}) {
  const targets = signalAllTargets(sig.parsed || {});
  return signalSelectedTargetIndexes(sig).map(i => targets[i]).filter(Boolean);
}

function signalOperationalPercents(count=0) {
  if (count <= 1) return [100, 0, 0];
  if (count === 2) return [50, 50, 0];
  return [33, 33, 34];
}

function signalTargetMeta(parsed={}, price) {
  const entry = Number(parsed.entry || 0);
  const sl = Number(parsed.sl || 0);
  const lev = Math.max(1, Number(parsed.leverage || 1));
  const sign = parsed.dir === 'short' ? -1 : 1;
  const risk = entry && sl ? Math.abs(entry - sl) : 0;
  const movePct = entry ? ((Number(price) - entry) / entry) * 100 * sign : null;
  const rr = risk ? Math.abs(Number(price) - entry) / risk : null;
  const pnlLev = movePct !== null ? movePct * lev : null;
  return {
    rr,
    movePct,
    pnlLev,
    rrText: rr ? `${rr.toFixed(2)}R` : 'R:R -',
    moveText: movePct !== null ? `${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%` : '-',
    pnlText: pnlLev !== null && lev > 1 ? `${pnlLev >= 0 ? '+' : ''}${pnlLev.toFixed(1)}% x${lev}` : '',
  };
}

function signalTargetsHtml(sig={}) {
  const parsed = sig.parsed || {};
  const targets = signalAllTargets(parsed);
  if (!targets.length) return '';
  const selected = new Set(signalSelectedTargetIndexes(sig));
  const html = targets.map((price, i) => {
    const m = signalTargetMeta(parsed, price);
    const extra = m.pnlText ? ` - ${m.pnlText}` : '';
    return `<div class="signal-target-pill ${selected.has(i) ? 'selected' : ''}" title="TP${i + 1}: ${m.rrText} - ${m.moveText}${extra}">
      <span>${selected.has(i) ? 'Sugerido ' : ''}TP${i + 1} - ${m.rrText}</span>
      <strong>$${fmtPx(price)}</strong>
      <small>${m.moveText}${extra}</small>
    </div>`;
  }).join('');
  return `<div class="signal-targets-grid">${html}</div>`;
}
function signalCardHtml(sig) {
  const p = sig.parsed || {};
  const dirCls = p.dir === 'short' ? 'bs' : p.dir === 'spot' ? 'bsp' : 'bl';
  const stateCls = ['ready','reviewed','converted','discarded'].includes(sig.status) ? sig.status : 'review';
  const confColor = sig.confidence >= 80 ? 'var(--accent)' : sig.confidence >= 55 ? 'var(--amber)' : 'var(--red)';
  const liq = p.dir !== 'spot' ? estimatedLiquidationPrice({ dir:p.dir, entry:p.entry, leverage:p.leverage, exchange:p.exchange }) : null;
  const tpSummary = signalBestTargetLabel(p);
  const targetsHtml = signalTargetsHtml(sig);
  const rrColor = sig.rr && sig.rr >= 2 ? 'var(--accent)' : 'var(--red)';
  const updates = Array.isArray(sig.updates) ? sig.updates : [];
  const chips = [
    ...(sig.market ? [`<span class="signal-chip ${signalEsc(sig.market.tone || '')}">${signalEsc(sig.market.label)}${sig.market.price ? ' · $'+fmtPx(sig.market.price) : ''}</span>`] : []),
    ...(sig.hasImage ? ['<span class="signal-chip blue">Imagen Telegram</span>'] : []),
    ...(sig.aiInterpreted ? [`<span class="signal-chip blue">AI interpretó${sig.aiUsedImage ? ' imagen' : ''} · revisar</span>`] : []),
    ...(sig.aiError ? [`<span class="signal-chip red">AI: ${signalEsc(sig.aiError)}</span>`] : []),
    ...(updates.length ? [`<span class="signal-chip blue">${updates.length} update${updates.length === 1 ? '' : 's'} Telegram</span>`] : []),
    ...(sig.missing || []).map(x => `<span class="signal-chip red">Falta ${signalEsc(x)}</span>`),
    ...(sig.warnings || []).map(x => `<span class="signal-chip">${signalEsc(x)}</span>`),
    ...(sig.status === 'converted' ? ['<span class="signal-chip green">Convertida</span>'] : []),
  ].join('');
  const statusText = sig.status === 'ready'
    ? 'Lectura confiable'
    : sig.status === 'reviewed'
      ? 'Revisada'
      : sig.status === 'converted'
        ? 'Ya convertida'
        : sig.status === 'discarded'
          ? 'Descartada'
          : 'Revisar lectura';
  const entryRangeLabel = p.entryIsCurrentMarket
    ? 'CMP precio actual'
    : (p.entryRange?.length > 1 ? p.entryRange.map(fmtPx).join(' - ') : '');
  const confidenceTip = 'Confianza mide que tan fiable es la lectura automatica del mensaje: datos completos, coherencia entre entry, SL y TPs, estado del precio actual y si parece una senal nueva o una actualizacion. No mide probabilidad de ganar.';
  const updatesHtml = updates.length
    ? `<div style="margin-top:10px;"><div style="font-family:var(--mono);font-size:10px;color:var(--t3);margin-bottom:6px;">Updates de Telegram</div>${updates.slice().reverse().map(u => `<div class="signal-raw" style="margin-top:6px;max-height:110px;">${signalEsc(fmtD(u.createdAt))}\n${signalEsc(u.raw)}</div>`).join('')}</div>`
    : '';
  const aiHtml = sig.aiInterpreted
    ? `<div style="margin-top:10px;font-family:var(--mono);font-size:10px;color:var(--t2);line-height:1.5;"><strong style="color:var(--blue);">AI</strong>${sig.aiConfidence ? ' · confianza '+Math.round(sig.aiConfidence) : ''}${sig.aiUsedImage ? ' · usó imagen' : ''}${sig.aiNotes ? '<br>'+signalEsc(sig.aiNotes) : ''}</div>`
    : '';
  const originalTime = signalOriginalTime(sig);
  const originalTimeOk = signalHasOriginalTime(sig);
  const signalTimeHtml = `
    <div class="signal-time-row ${originalTimeOk ? '' : 'missing'}">
      <span>Hora se&ntilde;al:</span>
      <strong>${signalEsc(signalDateTimeText(originalTime))}</strong>
      <button type="button" onclick="editSignalOriginalTime('${sig.id}')" title="Editar hora original">Editar</button>
    </div>`;
  return `
    <div class="signal-card ${stateCls}">
      <div class="signal-head">
        <div>
          <div class="signal-title">
            <span>${signalEsc(p.ticker || 'Ticker?')}</span>
            <span class="badge ${dirCls}">${signalEsc((p.dir || 'dir?').toUpperCase())}${p.leverage > 1 ? ' x'+p.leverage : ''}</span>
            <span style="font-size:11px;color:var(--t3);">${signalEsc(p.exchange || '')}</span>
            <span style="font-size:11px;color:var(--t3);">· ${signalEsc(sig.traderName || 'Sin trader')}</span>
          </div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--t3);margin-top:5px;">${statusText} · ${fmtD(sig.createdAt)}</div>
          ${signalTimeHtml}
        </div>
        <div style="text-align:right;">
          <div class="signal-confidence" style="color:${confColor};">${sig.confidence}</div>
          <div class="signal-confidence-label">confianza <span class="info-dot" data-tip="${signalEsc(confidenceTip)}" title="${signalEsc(confidenceTip)}">i</span></div>
        </div>
      </div>
      <div class="signal-body">
        <div class="signal-grid">
          ${signalFieldHtml('Precio actual', sig.market?.price ? '$'+fmtPx(sig.market.price) : '—', 'var(--magenta)', sig.market?.label || '')}
          ${signalFieldHtml('Entry', p.entry ? '$'+fmtPx(p.entry) : '—', 'var(--t1)', entryRangeLabel ? `zona ${entryRangeLabel}` : '')}
          ${signalFieldHtml('SL', p.sl ? '$'+fmtPx(p.sl) : '—', 'var(--red)')}
          ${signalFieldHtml('Liq.', liq ? '$'+fmtPx(liq) : '—', 'var(--amber)')}
          ${signalFieldHtml('TP', tpSummary.value, 'var(--accent)', tpSummary.sub)}
          ${signalFieldHtml('R:R', sig.rr ? sig.rr.toFixed(2)+':1' : '—', rrColor, sig.rrFirst ? `TP1 ${sig.rrFirst.toFixed(2)}:1` : '')}
        </div>
        ${targetsHtml}
        ${chips ? `<div class="signal-warnings">${chips}</div>` : ''}
        <button class="signal-toggle" type="button" onclick="toggleSignalRaw('${sig.id}')">
          <span>Texto de la se&ntilde;al</span>
          <span id="signalRawArrow-${sig.id}">▼</span>
        </button>
        <div id="signalRawPanel-${sig.id}" class="signal-raw-panel" style="display:none;">
          <div class="signal-raw">${signalEsc(sig.raw)}</div>
          ${aiHtml}
          ${updatesHtml}
        </div>
        <button class="signal-toggle" type="button" onclick="toggleSignalChart('${sig.id}')">
          <span>Gr&aacute;fico</span>
          <span id="signalChartArrow-${sig.id}">▼</span>
        </button>
        <div id="signalChartPanel-${sig.id}" class="signal-chart-panel" style="display:none;">
          <div class="signal-chart-tools">
            ${['30m','1h','4h','1d','1w','1M'].map(tf => `<button class="signal-tf-btn ${tf === '1h' ? 'active' : ''}" data-sig-chart="${sig.id}" data-sig-tf="${tf}" onclick="event.stopPropagation();setSignalChartTimeframe('${sig.id}','${tf}')">${mainChartLabel(tf)}</button>`).join('')}
          </div>
          <div id="signalChart-${sig.id}" class="signal-chart"></div>
        </div>
      </div>
      <div class="signal-actions">
        <button class="btn sm acc" onclick="signalToCalculator('${sig.id}')">Calculadora</button>
        <button class="btn sm signal-chart-btn" title="Abrir en Charts" onclick="signalOpenChart('${sig.id}')">📈</button>
        <button class="btn sm" onclick="discardSignal('${sig.id}')">${sig.status === 'discarded' ? 'Borrar' : 'Descartar'}</button>
      </div>
    </div>`;
}

window.toggleSignalTarget = (id, index) => {
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  if (!sig) return;
  const targets = signalAllTargets(sig.parsed || {});
  if (!targets[index]) return;
  const chartWasOpen = document.getElementById(`signalChartPanel-${id}`)?.style.display !== 'none';
  const visibleLogicalRange = chartWasOpen
    ? signalChartState[id]?.chart?.timeScale?.()?.getVisibleLogicalRange?.()
    : null;
  let selected = sig.targetSelectionManual ? signalSelectedTargetIndexes(sig) : [];
  if (!sig.targetSelectionManual) {
    sig.targetSelectionManual = true;
    selected = [index];
  } else if (selected.includes(index)) {
    selected = selected.filter(i => i !== index);
  } else {
    if (selected.length >= 3) {
      toast('Máximo 3 TP operativos para Calculadora.', 'error');
      return;
    }
    selected.push(index);
  }
  if (!selected.length) {
    sig.targetSelectionManual = false;
    sig.selectedTargetIndexes = [];
  } else {
    sig.selectedTargetIndexes = [...new Set(selected)].sort((a,b) => a - b).slice(0, 3);
  }
  saveSignalStateRemote(sig, {
    targetSelectionManual: !!sig.targetSelectionManual,
    selectedTargetIndexes: sig.selectedTargetIndexes || [],
  });
  saveSignalInbox(items);
  renderSignals();
  if (chartWasOpen) {
    const panel = document.getElementById(`signalChartPanel-${id}`);
    const arrow = document.getElementById(`signalChartArrow-${id}`);
    if (panel) panel.style.display = 'block';
    if (arrow) arrow.textContent = '▲';
    renderSignalInlineChart(sig, { visibleLogicalRange });
  }
};
window.toggleSignalRaw = id => {
  const panel = document.getElementById(`signalRawPanel-${id}`);
  const arrow = document.getElementById(`signalRawArrow-${id}`);
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (arrow) arrow.textContent = opening ? '▲' : '▼';
};

function renderSignals() {
  const items = pruneSignalInbox(applySignalRemoteStates(loadSignalInbox()));
  saveSignalInbox(items);
  renderSignalStats(items);
  renderSignalFilters(items);
  const el = document.getElementById('signalInbox');
  if (!el) return;
  const visible = items.filter(x => signalMatchesFilters(x));
  el.innerHTML = visible.length
    ? visible.map(signalCardHtml).join('')
    : `<div class="empty"><div class="empty-icon">◇</div><div class="empty-text">No hay señales en inbox</div><div class="empty-sub">Pegá un mensaje de Telegram para empezar.</div></div>`;
}

window.editSignalOriginalTime = async id => {
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  if (!sig) return;
  const current = signalDateTimeInputValue(signalOriginalTime(sig));
  const raw = prompt('Hora original de la señal (ej: 2026-06-14 22:58). Dejá vacío para quitarla.', current);
  if (raw === null) return;
  const iso = parseSignalManualDateTime(raw);
  if (raw.trim() && !iso) {
    toast('No pude leer esa fecha. Usá formato 2026-06-14 22:58 o 14/06/2026 22:58.', 'error');
    return;
  }
  sig.signalTime = iso;
  sig.originalMessageDate = iso;
  sig.originalDateMissing = !iso;
  sig.signalTimeManual = !!iso;
  await saveSignalStateRemoteAsync(sig, {
    signalTime: sig.signalTime,
    originalMessageDate: sig.originalMessageDate,
    originalDateMissing: sig.originalDateMissing,
    signalTimeManual: sig.signalTimeManual,
  }).catch(()=>{});
  saveSignalInbox(items);
  renderSignals();
  toast(iso ? 'Hora original actualizada.' : 'Hora original quitada.');
};

async function fetchTelegramSignals(secret='') {
  const qs = new URLSearchParams({ t: Date.now().toString() });
  const headers = {};
  if (secret) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  const r = await window.workerFetch(`/telegram-signals?${qs.toString()}`, { cache:'no-store', headers });
  if (r.status === 401 || r.status === 403) {
    const e = new Error('secret_required');
    e.status = r.status;
    throw e;
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function signalNeedsAi(sig={}) {
  const p = sig.parsed || {};
  const source = signalNormText(`${sig.sourceName || ''} ${sig.traderName || ''} ${sig.raw || ''}`);
  const isStandardProvider = /binance\s*killers|bitcoin\s*bullets/.test(source);
  const missing = (sig.missing || []).filter(x => !(x === 'entry' && p.entryIsCurrentMarket));
  const criticalMissing = missing.some(x => ['ticker','direccion','entry','SL','TP'].includes(x));
  const structuralWarning = (sig.warnings || []).some(x => /raro|update|Sin precio live/i.test(x));
  if (isStandardProvider && !criticalMissing && !structuralWarning) return false;
  if (p.type && p.type !== 'new_signal' && !sig.hasImage && !criticalMissing) return false;
  if (sig.hasImage) return true;
  if (!criticalMissing && !structuralWarning && Number(sig.confidence || 0) >= 72) return false;
  return criticalMissing || (sig.hasImage && (criticalMissing || structuralWarning || Number(sig.confidence || 0) < 86));
}

function legacySignalLooksActionableMessage(raw='', hasImage=false) {
  const text = String(raw || '').trim();
  if (!text) return false;
  const upper = text.toUpperCase();
  const hasTicker = /(?:COIN|PAIR|SYMBOL)\s*[:=]?\s*[$#]?[A-Z0-9]{2,15}/i.test(text) || /[$#][A-Z0-9]{2,15}(?:\/?(?:USDT|USDC|USD|PERP))?\b/i.test(text);
  const hasSetupWord = /\b(LONG|SHORT|LONGS|SHORTS|BUYING\s+SETUP|SELLING\s+SETUP|LIMIT\s+LONG|LIMIT\s+SHORT|SCALP\s+LONGS?|SCALP\s+SHORTS?)\b/i.test(text);
  const hasLevels = /\b(ENTRY|ENTRADA|CMP|TARGETS?|TAKE\s*PROFIT|TP\d*|STOP\s*LOSS|SL)\b/i.test(text);
  const hasPriceZone = /(?:\d+(?:\.\d+)?\s*K?|\d+\.\d+)\s*[-–]\s*(?:\d+(?:\.\d+)?\s*K?|\d+\.\d+)/i.test(text);
  const hasTargetLanguage = /\b(TARGET|TARGETS?|SUB\s*[- ]?\s*\d+K?|SL|STOP|ZONE|AREA)\b/i.test(text);
  const hasManagement = /\b(SIGNAL\s*ID|UPDATE|CLOSING|CLOSED|BREAKEVEN|BREAK\s*EVEN|TARGET\s*\d+\s*:|TP\s*\d+\s*(HIT|TOC|✅))\b/i.test(text);
  const looksLikeAdOnly = /\b(SUBSCRIBE|PROMO|DISCOUNT|JOIN\s+VIP|SALE|RESULTS?|PROFIT\s+TODAY)\b/i.test(text) && !hasLevels;
  const looksLikeMacroOnly = /\b(MACRO|MARKET\s+UPDATE|NEWS|CPI|FOMC|FED|INFLATION|DXY|YIELDS?)\b/i.test(text) && !hasLevels;
  if (looksLikeAdOnly || looksLikeMacroOnly) return false;
  if (hasTicker && (hasSetupWord || hasLevels || hasManagement)) return true;
  if (hasImage && hasSetupWord && (hasLevels || hasPriceZone || hasTargetLanguage)) return true;
  return !!(hasImage && hasTicker && hasLevels);
}

function signalLooksActionableMessage(raw='', hasImage=false) {
  const text = String(raw || '').trim();
  if (!text) return false;
  const hasTicker = /(?:NEW\s+SIGNAL|COIN|PAIR|SYMBOL)\s*[-—:]?\s*[$#]?[A-Z0-9]{2,15}/i.test(text)
    || /[$#][A-Z0-9]{2,15}(?:\/?(?:USDT|USDC|USD|PERP))?\b/i.test(text)
    || /\b[A-Z0-9]{2,15}\s*\/\s*(?:USDT|USDC|USD|PERP)\b/i.test(text);
  const hasSetupWord = /\b(LONG|SHORT|LONGS|SHORTS|BUYING\s+SETUP|SELLING\s+SETUP|LIMIT\s+LONG|LIMIT\s+SHORT|SCALP\s+LONGS?|SCALP\s+SHORTS?)\b/i.test(text);
  const hasLevels = /\b(ENTRY|ENTRADA|CMP|TARGETS?|TAKE\s*PROFIT|TP\d*|STOP\s*LOSS|SL)\b/i.test(text);
  const hasPriceZone = /(?:\d+(?:[.,]\d+)?\s*K?|\d+[.,]\d+)\s*[-–—]\s*(?:\d+(?:[.,]\d+)?\s*K?|\d+[.,]\d+)/i.test(text);
  const hasTargetLanguage = /\b(TARGET|TARGETS?|SUB\s*[- ]?\s*\d+K?|SL|STOP|ZONE|AREA|RISK)\b/i.test(text);
  const hasManagement = /\b(SIGNAL\s*ID|UPDATE|CLOSING|CLOSED|BREAKEVEN|BREAK\s*EVEN|TARGET\s*\d+\s*:|TP\s*\d+\s*(HIT|TOC|OK))\b/i.test(text) || /✅/.test(text);
  const hasManyPrices = (text.match(/\$?\d+(?:[.,]\d+)?\s*[kK]?/g) || []).length >= 3;
  const looksLikeAdOnly = /\b(SUBSCRIBE|PROMO|DISCOUNT|JOIN\s+VIP|SALE|RESULTS?|PROFIT\s+TODAY)\b/i.test(text) && !hasLevels;
  const looksLikeMacroOnly = /\b(MACRO|MARKET\s+UPDATE|NEWS|CPI|FOMC|FED|INFLATION|DXY|YIELDS?)\b/i.test(text) && !hasLevels;
  if (looksLikeAdOnly || looksLikeMacroOnly) return false;
  if (hasTicker && (hasSetupWord || hasLevels || hasManagement || hasManyPrices)) return true;
  if (hasImage && hasSetupWord && (hasLevels || hasPriceZone || hasTargetLanguage)) return true;
  if ((hasImage || hasTicker) && hasManyPrices && (hasLevels || hasPriceZone || hasTargetLanguage)) return true;
  return !!(hasImage && (hasTicker || hasLevels || hasManyPrices));
}

async function fetchSignalAi(sig={}, secret='') {
  if (!PROXY_URL) return null;
  const qs = new URLSearchParams({ t: Date.now().toString() });
  const r = await window.workerFetch(`/telegram-signal-ai?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}),
    },
    body: JSON.stringify({
      raw: sig.raw || '',
      sourceName: sig.sourceName || sig.traderName || '',
      photoFileId: sig.imageFileId || '',
      imageBase64: sig.imageBase64 || '',
      imageMimeType: sig.imageMimeType || '',
    }),
  });
  if (r.status === 401 || r.status === 403) {
    const e = new Error('secret_required');
    e.status = r.status;
    throw e;
  }
  const data = await r.json().catch(() => null);
  if (r.status === 501) return null;
  if (!r.ok) {
    throw new Error(data?.error || data?.message || `AI HTTP ${r.status}`);
  }
  return data;
}

function signalApplyAiInterpretation(sig={}, ai={}) {
  const data = ai.interpretation || ai;
  if (!data || typeof data !== 'object') return sig;
  const p = sig.parsed || {};
  const aiWarnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
  const aiFallback = /fallback|respaldo|no disponible|local no disponible/i.test(`${ai.warning || ''} ${data.notes || ''} ${aiWarnings.join(' ')}`);
  const sameScale = (next, current) => {
    const a = Number(next || 0);
    const b = Number(current || 0);
    if (!(a > 0)) return false;
    if (!(b > 0)) return true;
    const ratio = Math.max(a, b) / Math.max(1e-9, Math.min(a, b));
    return ratio < 20;
  };
  const applyLevel = (key, value) => {
    const next = Number(value || 0);
    if (!(next > 0)) return;
    if (!p[key] || (!aiFallback && sameScale(next, p[key]))) p[key] = next;
  };
  if (data.ticker) p.ticker = String(data.ticker).replace(/USDT|USDC|USD|PERP/ig,'').toUpperCase();
  if (data.direction) p.dir = String(data.direction).toLowerCase();
  if (data.exchange) p.exchange = String(data.exchange).toUpperCase();
  if (Number(data.leverage) > 0) p.leverage = Math.max(1, Math.min(125, Number(data.leverage)));
  if (Array.isArray(data.entryRange) && data.entryRange.length) {
    const nextRange = data.entryRange.map(Number).filter(Boolean).slice(0, 2);
    const currentRef = p.entry || p.entryRange?.[0] || 0;
    if (nextRange.length && (!p.entryRange?.length || (!aiFallback && sameScale(nextRange[0], currentRef)))) p.entryRange = nextRange;
  }
  applyLevel('entry', data.entry);
  if (!p.entry && p.entryRange?.length) p.entry = signalChooseEntry(p.entryRange, p.ticker, p.dir);
  applyLevel('sl', data.sl);
  if (Array.isArray(data.targets)) {
    const targets = [...new Set(data.targets.map(Number).filter(Boolean))]
      .filter(n => signalTargetLooksValid(n, p))
      .filter(n => !p.entry || sameScale(n, p.entry))
      .slice(0, 12);
    if (targets.length && (!p.targets?.length || !aiFallback)) {
      p.targets = targets;
      const pct = Math.round((100 / targets.length) * 100) / 100;
      p.targetPercents = targets.map((_, i) => i === targets.length - 1 ? Math.round((100 - pct * (targets.length - 1)) * 100) / 100 : pct);
      [p.tp1, p.tp2, p.tp3] = [targets[0] || 0, targets[1] || 0, targets[2] || 0];
    }
  }
  if (data.providerSignalId) {
    sig.providerSignalId = String(data.providerSignalId).toUpperCase();
    p.providerSignalId = sig.providerSignalId;
  }
  if (data.type) p.type = data.type;
  sig.parsed = p;
  sig.aiInterpreted = true;
  sig.aiModel = ai.model || '';
  sig.aiUsedImage = !!ai.usedImage;
  sig.aiNotes = data.notes || '';
  sig.aiConfidence = Number(data.confidence || 0) || 0;
  sig.parserVersion = SIGNAL_PARSE_VERSION;
  const missing = [];
  if (!p.ticker) missing.push('ticker');
  if (!p.dir) missing.push('direccion');
  if (!p.entry) missing.push('entry');
  if (!p.sl) missing.push('SL');
  if (!p.tp1) missing.push('TP');
  sig.missing = missing;
  sig.warnings = [...new Set([...(sig.warnings || []).filter(x => !/^Falta /i.test(x)), ...aiWarnings])];
  sig.confidence = aiFallback ? Math.max(5, Math.min(98, Number(sig.confidence || 50))) : Math.max(5, Math.min(98, Number(data.confidence || sig.confidence || 50)));
  sig.status = missing.length ? 'review' : 'ready';
  sig.rrFirst = p.sl && p.entry && p.tp1 ? Math.abs((p.tp1 - p.entry) / (p.sl - p.entry)) : null;
  sig.rr = signalWeightedRR(p);
  return sig;
}

async function signalMaybeInterpretWithAi(sig={}, secret='') {
  if (!signalNeedsAi(sig)) return sig;
  try {
    const ai = await fetchSignalAi(sig, secret);
    if (ai?.interpretation) signalApplyAiInterpretation(sig, ai);
  } catch(e) {
    sig.aiError = e.message;
  }
  return sig;
}

window.syncTelegramSignals = async (silent=false) => {
  if (_signalTelegramSyncing) {
    if (!silent) _signalTelegramRunAgain = true;
    return;
  }
  if (!PROXY_URL) { if (!silent) toast('Falta configurar el Worker de MAUex.', 'error'); return; }
  _signalTelegramSyncing = true;
  try {
    let secret = localStorage.getItem(SIGNAL_TELEGRAM_SECRET_KEY) || '';
    let data;
    try {
      data = await fetchTelegramSignals(secret);
    } catch(e) {
      if (e.status === 403 && !silent) {
        secret = prompt('Ingresá la clave de la bandeja Telegram de MAUex:') || '';
        if (!secret) return;
        localStorage.setItem(SIGNAL_TELEGRAM_SECRET_KEY, secret);
        data = await fetchTelegramSignals(secret);
      } else if (e.status === 403) {
        return;
      } else {
        throw e;
      }
    }
    const incoming = Array.isArray(data?.signals) ? data.signals : [];
    if (window._loadSignalStates) {
      try { _signalRemoteStates = await window._loadSignalStates() || {}; } catch(e) {}
    }
    if (!incoming.length) {
      if (currentVisiblePage() === 'signals') renderSignals();
      return;
    }
    const items = pruneSignalInbox(applySignalRemoteStates(loadSignalInbox()));
    const seen = new Set(items.map(x => x.telegramId || x.id).filter(Boolean));
    const fresh = incoming.filter(x => x?.raw && !seen.has(x.telegramId || x.id) && !signalIsRemotelySuppressed(x));
    if (!fresh.length) {
      if (currentVisiblePage() === 'signals') renderSignals();
      return;
    }
    let imported = 0;
    let merged = 0;
    let ignored = 0;
    for (const msg of fresh.reverse()) {
      if (!signalLooksActionableMessage(msg.raw || '', !!msg.hasImage)) {
        if (msg.telegramId || msg.id) seen.add(msg.telegramId || msg.id);
        ignored++;
        continue;
      }
      const sourceName = msg.sourceName || 'Telegram';
      const traderId = signalTraderIdFromSource(sourceName);
      const sig = parseSignalMessage(msg.raw, {
        traderId,
        traderName: sourceName,
        source: 'telegram',
        sourceName,
        telegramId: msg.telegramId || msg.id || '',
        exchange: 'BINANCE',
      });
      sig.id = msg.id || sig.id;
      sig.signalTime = msg.signalTime || msg.originalMessageDate || msg.date || '';
      sig.originalMessageDate = sig.signalTime;
      sig.originalDateMissing = !!msg.originalDateMissing || !sig.signalTime;
      sig.receivedAt = msg.receivedAt || '';
      sig.importedAt = new Date().toISOString();
      sig.messageDate = msg.messageDate || '';
      if (sig.signalTime) sig.createdAt = sig.signalTime;
      sig.hasImage = !!msg.hasImage;
      sig.imageFileId = msg.imageFileId || '';
      sig.imageWidth = Number(msg.imageWidth || 0);
      sig.imageHeight = Number(msg.imageHeight || 0);
      sig.imageBase64 = msg.imageBase64 || '';
      sig.imageMimeType = msg.imageMimeType || '';
      sig.imageBytes = Number(msg.imageBytes || 0);
      sig.imageError = msg.imageError || '';
      sig.imageSkipped = !!msg.imageSkipped;
      await signalMaybeInterpretWithAi(sig, secret);
      await signalHydrateMarket(sig);
      const existingIndex = signalFindExistingSignalIndex(items, sig);
      if (existingIndex >= 0 && items[existingIndex]) {
        signalMergeUpdateIntoBase(items[existingIndex], sig);
        if (sig.telegramId) seen.add(sig.telegramId);
        merged++;
        continue;
      }
      items.unshift(sig);
      imported++;
    }
    saveSignalInbox(pruneSignalInbox(applySignalRemoteStates(items)));
    renderSignals();
    updateNavAlertBadges?.();
  } catch(e) {
    if (!silent) toast('Telegram: ' + e.message, 'error');
  } finally {
    _signalTelegramSyncing = false;
    if (_signalTelegramRunAgain) {
      _signalTelegramRunAgain = false;
      setTimeout(() => window.syncTelegramSignals?.(false), 300);
    }
  }
};

function startTelegramAutoSync() {
  if (_signalTelegramAutoTimer) clearInterval(_signalTelegramAutoTimer);
  setTimeout(() => window.refreshSignalRemoteStates?.(), 1200);
  setTimeout(() => window.syncTelegramSignals?.(true), 2500);
  _signalTelegramAutoTimer = setInterval(() => {
    window.refreshSignalRemoteStates?.();
    window.syncTelegramSignals?.(true);
  }, 15000);
}

window.parseSignalInboxInput = async () => {
  const raw = document.getElementById('signalRawInput')?.value || '';
  if (!raw.trim()) { toast('Pegá primero el mensaje del trader.', 'error'); return; }
  const traderId = document.getElementById('signalTraderSelect')?.value || '';
  const exchange = document.getElementById('signalExchangeSelect')?.value || 'BINANCE';
  const sig = parseSignalMessage(raw, { traderId, exchange });
  await signalMaybeInterpretWithAi(sig, localStorage.getItem(SIGNAL_TELEGRAM_SECRET_KEY) || '');
  await signalHydrateMarket(sig);
  const items = loadSignalInbox();
  const existingIndex = signalFindExistingSignalIndex(items, sig);
  if (existingIndex >= 0) {
    signalMergeUpdateIntoBase(items[existingIndex], sig);
    saveSignalInbox(items);
    document.getElementById('signalRawInput').value = '';
    renderSignals();
    return;
  }
  items.unshift(sig);
  saveSignalInbox(items);
  document.getElementById('signalRawInput').value = '';
  renderSignals();
  toast(sig.status === 'ready' ? 'Señal interpretada.' : 'Señal creada para revisar.', sig.status === 'ready' ? 'success' : 'error');
};

function applySignalToCalculator(sig) {
  const p = sig?.parsed || {};
  if (!p.ticker || !p.entry) { toast('La señal necesita ticker y entry.', 'error'); return false; }
  const dir = p.dir || 'long';
  window.showPage('calc');
  window.clearCalculatorEditMode?.();
  setCalcTpPercentsManual(false);
  setDir(dir);
  if (dir !== 'spot') {
    const ex = String(p.exchange || 'BINANCE').toLowerCase();
    if (['binance','bybit','okx','mexc','kucoin'].includes(ex)) setEx(ex);
  }
  if (p.leverage) pickLev(p.leverage);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('cTicker', p.ticker || '');
  const signalIsCrypto = appIsCryptoTicker(p.ticker || '', p.exchange || 'BINANCE');
  setCalcTickerSource(signalIsCrypto ? String(p.exchange || 'binance').toLowerCase() : 'yahoo', signalIsCrypto ? 'crypto' : 'stock', signalIsCrypto ? (dir === 'spot' ? 'spot' : 'futures') : 'spot');
  set('cEntry', p.entry || '');
  set('cSL', p.sl || '');
  const allTargets = signalAllTargets(p);
  const selectedIndexes = allTargets.length ? signalSelectedTargetIndexes(sig) : [];
  const calcTargets = selectedIndexes.map(i => allTargets[i]).filter(Boolean);
  set('cTP1', calcTargets[0] || '');
  set('cTP2', calcTargets[1] || '');
  set('cTP3', calcTargets[2] || '');
  const visibleTpPct = signalOperationalPercents(calcTargets.length);
  set('cTP1pct', visibleTpPct[0] || '');
  set('cTP2pct', visibleTpPct[1] || '');
  set('cTP3pct', visibleTpPct[2] || '');
  set('cSize', '');
  const signalUnix = signalTimeUnix(sig);
  calcChartState.signalTime = signalUnix || 0;
  calcChartState.key = '';
  const signalTraderId = sig.traderId || signalTraderIdFromSource(sig.sourceName || sig.traderName || '');
  if (signalTraderId) set('cTrader', signalTraderId);
  calcSignalTargetsState = allTargets.length ? {
    signalId: sig.id || '',
    targets: allTargets,
    selectedIndexes: selectedIndexes.slice(0, 3),
    entry: p.entry || 0,
    sl: p.sl || 0,
    dir: p.dir || dir,
    leverage: p.leverage || 1,
    signalTime: signalUnix || 0,
  } : null;
  const operationalTargetsNote = calcTargets.length
    ? `TP operativos elegidos: ${calcTargets.map((x,i)=>`TP${i+1} ${fmtPx(x)}`).join(' / ')}`
    : '';
  const fullTargetsNote = p.targets?.length
    ? `Targets completos: ${p.targets.map((x,i)=>`TP${i+1} ${fmtPx(x)}`).join(' / ')}`
    : '';
  set('cNotes', [sig.traderName ? `Trader: ${sig.traderName}` : '', p.entryRange?.length > 1 ? `Entry original: ${p.entryRange.map(fmtPx).join(' - ')}` : '', operationalTargetsNote, fullTargetsNote, 'Señal original:', sig.raw].filter(Boolean).join('\n') );
  window._signalTradeExtras = {
    source: 'signal_desk',
    signalId: sig.id || '',
    ticker: p.ticker || '',
    entry: p.entry || 0,
    entryRange: Array.isArray(p.entryRange) ? p.entryRange : [],
    targets: Array.isArray(p.targets) ? p.targets : [],
    targetPercents: Array.isArray(p.targetPercents) ? p.targetPercents : [],
    selectedTargets: calcTargets,
    selectedTargetIndexes: selectedIndexes,
    signalTime: signalOriginalTime(sig),
    originalMessageDate: sig.originalMessageDate || sig.signalTime || '',
    raw: sig.raw || '',
  };
  renderCalcSignalTargets();
  compute();
  return true;
}

window.signalToCalculator = async id => {
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  await signalHydrateMarket(sig);
  if (sig && !['converted','discarded'].includes(sig.status)) {
    sig.status = 'reviewed';
    sig.reviewedAt = new Date().toISOString();
    saveSignalStateRemote(sig, { status:'reviewed', reviewedAt:sig.reviewedAt });
  }
  saveSignalInbox(items);
  renderSignals();
  updateNavAlertBadges?.();
  if (applySignalToCalculator(sig)) toast('Señal cargada en Calculadora.');
};

const signalChartState = {};
const signalChartTfState = {};

function signalChartInfo(sig) {
  const p = sig?.parsed || {};
  const raw = String(p.ticker || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g,'');
  if (!raw) return null;
  const crypto = appIsCryptoTicker(raw, p.exchange || 'BINANCE');
  const symbol = crypto
    ? (raw.endsWith('USDT') || raw.endsWith('USDC') || raw.includes('_') ? raw.replace(/USDC$/,'USDT') : raw + 'USDT')
    : raw;
  return { raw, symbol, source: crypto ? 'binance' : 'yahoo', type: crypto ? 'crypto' : 'stock' };
}

function signalChartLevels(sig) {
  const p = sig?.parsed || {};
  const liq = p.dir !== 'spot' ? estimatedLiquidationPrice({ dir:p.dir, entry:p.entry, leverage:p.leverage, exchange:p.exchange }) : null;
  const targets = signalAllTargets(p);
  const selectedTargets = new Set(signalSelectedTargetIndexes(sig));
  const targetLevels = targets.slice(0, 12).map((price, i) => {
    const selected = selectedTargets.has(i);
    return {
      price,
      title:`TP${i+1}`,
      color:selected ? 'rgba(0,196,122,.96)' : 'rgba(0,196,122,.28)',
      lineWidth:selected ? 2 : 1,
      lineStyle:selected ? 0 : 1,
    };
  });
  return [
    ...(sig?.market?.price ? [{ price:sig.market.price, title:'Actual', color:'rgba(224,64,251,.98)' }] : []),
    ...(p.entry ? [{ price:p.entry, title:'Entry', color:'rgba(232,237,243,.95)' }] : []),
    ...(p.sl ? [{ price:p.sl, title:'SL', color:'rgba(240,61,61,.95)' }] : []),
    ...(liq ? [{ price:liq, title:'Liq', color:'rgba(245,158,11,.95)' }] : []),
    ...targetLevels,
  ];
}

function destroySignalChart(id) {
  const st = signalChartState[id];
  if (st?.guideRemove) { try { st.guideRemove(); } catch(e) {} }
  if (st?.resize) { try { st.resize.disconnect(); } catch(e) {} }
  if (st?.chart) { try { st.chart.remove(); } catch(e) {} }
  delete signalChartState[id];
}

function mauexChartPriceDecimals(price) {
  const n = Math.abs(Number(price));
  if (!Number.isFinite(n)) return 4;
  if (n > 0 && n < 0.0001) return 8;
  if (n > 0 && n < 0.01) return 6;
  return 4;
}

function mauexChartPriceFormatter(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '';
  const decimals = mauexChartPriceDecimals(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function mauexPriceSeriesFormat() {
  return { type:'custom', minMove:0.00000001, formatter: mauexChartPriceFormatter };
}

function syncCalcChartSignalTime() {
  if (calcChartState.signalTime) return calcChartState.signalTime;
  const fromTargets = Number(calcSignalTargetsState?.signalTime || 0);
  if (fromTargets) {
    calcChartState.signalTime = fromTargets;
    return fromTargets;
  }
  const fromExtrasRaw = window._signalTradeExtras?.signalTime || window._signalTradeExtras?.originalMessageDate || '';
  const fromExtrasUnix = dateLikeToUnix(fromExtrasRaw);
  if (fromExtrasUnix) {
    calcChartState.signalTime = fromExtrasUnix;
    return calcChartState.signalTime;
  }
  return 0;
}

function addChartTimeGuide(el, chart, unix, label='Señal', tone='signal') {
  if (!el || !chart || !unix) return null;
  el.style.position = 'relative';
  const guide = document.createElement('div');
  guide.className = `signal-time-guide ${tone === 'execution' ? 'execution-time-guide' : ''}`.trim();
  guide.innerHTML = `<span>${signalEsc(label)}</span>`;
  el.appendChild(guide);
  const update = () => {
    const x = chart.timeScale().timeToCoordinate(unix);
    const width = el.clientWidth || 0;
    if (x === null || x === undefined || Number.isNaN(Number(x)) || Number(x) < 0 || (width && Number(x) > width)) {
      guide.style.display = 'none';
      return;
    }
    guide.style.display = 'block';
    guide.style.left = `${Math.round(Number(x))}px`;
  };
  chart.timeScale().subscribeVisibleTimeRangeChange(update);
  try { chart.timeScale().subscribeVisibleLogicalRangeChange(update); } catch(e) {}
  [0, 50, 250, 800].forEach(ms => setTimeout(update, ms));
  return () => {
    try { chart.timeScale().unsubscribeVisibleTimeRangeChange(update); } catch(e) {}
    try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(update); } catch(e) {}
    guide.remove();
  };
}

function chartCandleUnix(time) {
  if (typeof time === 'number') return time;
  if (typeof time === 'string') {
    const ms = Date.parse(time);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }
  if (time && typeof time === 'object' && time.year && time.month && time.day) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }
  return 0;
}

function nearestCandleTimeForGuide(candles=[], unix=0) {
  if (!unix || !candles.length) return 0;
  const times = candles.map(c => chartCandleUnix(c.time)).filter(Boolean).sort((a,b) => a - b);
  if (!times.length) return 0;
  const defaultStep = times.length > 1 ? Math.max(60, Math.abs(times[1] - times[0])) : 86400;
  if (unix < times[0] - defaultStep || unix > times[times.length - 1] + defaultStep) return 0;
  let best = times[0];
  let bestDist = Math.abs(unix - best);
  for (const t of times) {
    const dist = Math.abs(unix - t);
    if (dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  return best;
}

function addSignalTimeGuide(el, chart, sig, candles=[]) {
  const guideTime = nearestCandleTimeForGuide(candles, signalTimeUnix(sig));
  return addChartTimeGuide(el, chart, guideTime, 'Señal');
}

async function renderSignalInlineChart(sig, opts={}) {
  const id = sig?.id;
  const el = document.getElementById(`signalChart-${id}`);
  if (!id || !el) return;
  destroySignalChart(id);
  const info = signalChartInfo(sig);
  if (!info) return;
  const p = sig?.parsed || {};
  const tf = signalChartTfState[id] || '1h';
  document.querySelectorAll(`[data-sig-chart="${id}"]`).forEach(b => b.classList.toggle('active', b.dataset.sigTf === tf));
  el.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--t3);font-family:var(--mono);font-size:11px;">Cargando gráfico ${mainChartLabel(tf)}...</div>`;
  const prevSource = window._aiSource;
  const prevType = window._aiType;
  const prevMarketType = aiMarketType;
  try {
    window._aiSource = info.source;
    window._aiType = info.type;
    if (info.type === 'crypto') aiMarketType = p.dir === 'spot' ? 'spot' : 'futures';
    const candles = await fetchOHLCV(info.symbol, tf, mainChartLimit(tf));
    if (!candles.length) throw new Error('Sin datos');
    el.innerHTML = '';
    const chart = LightweightCharts.createChart(el, {
      width: el.clientWidth || 720,
      height: el.clientHeight || 280,
      layout:{ background:{color:'transparent'}, textColor:'#8ea0b5' },
      localization:{ priceFormatter: mauexChartPriceFormatter },
      grid:{ vertLines:{color:'rgba(255,255,255,0.035)'}, horzLines:{color:'rgba(255,255,255,0.035)'} },
      crosshair:{ mode:1 },
      rightPriceScale:{ borderColor:'rgba(255,255,255,0.10)', scaleMargins:{top:0.08,bottom:0.18} },
      timeScale:{ borderColor:'rgba(255,255,255,0.10)', timeVisible:true, secondsVisible:false },
      handleScroll:{ mouseWheel:true, pressedMouseMove:true, horzTouchDrag:true, vertTouchDrag:true },
      handleScale:{ axisPressedMouseMove:true, mouseWheel:true, pinch:true },
    });
    const series = chart.addCandlestickSeries({
      upColor:'#00c47a', downColor:'#f03d3d',
      borderUpColor:'#00c47a', borderDownColor:'#f03d3d',
      wickUpColor:'#00a85a', wickDownColor:'#c03030',
      priceFormat: mauexPriceSeriesFormat(),
    });
    series.setData(candles);
    const firstTime = candles[0]?.time;
    const lastTime = candles[candles.length - 1]?.time;
    signalChartLevels(sig).forEach(lvl => {
      try {
        addHorizontalLevel(chart, lvl.price, firstTime, lastTime, { color:lvl.color, lineStyle:lvl.lineStyle ?? 2, lineWidth:lvl.lineWidth || 1 });
        series.createPriceLine({ price:lvl.price, color:lvl.color, lineWidth:lvl.lineWidth || 1, lineStyle:lvl.lineStyle ?? 2, axisLabelVisible:true, title:lvl.title });
      } catch(e) {}
    });
    if (opts.visibleLogicalRange) {
      chart.timeScale().setVisibleLogicalRange(opts.visibleLogicalRange);
    } else {
      chart.timeScale().fitContent();
    }
    const resize = new ResizeObserver(() => chart.applyOptions({ width:el.clientWidth, height:el.clientHeight || 280 }));
    resize.observe(el);
    const guideRemove = addSignalTimeGuide(el, chart, sig, candles);
    signalChartState[id] = { chart, resize, guideRemove };
  } catch(e) {
    el.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--red);font-family:var(--mono);font-size:11px;">${signalEsc(e.message)}</div>`;
  } finally {
    window._aiSource = prevSource;
    window._aiType = prevType;
    aiMarketType = prevMarketType;
  }
}

window.toggleSignalChart = async id => {
  const panel = document.getElementById(`signalChartPanel-${id}`);
  const arrow = document.getElementById(`signalChartArrow-${id}`);
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (arrow) arrow.textContent = opening ? '▲' : '▼';
  if (!opening) { destroySignalChart(id); return; }
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  await signalHydrateMarket(sig);
  saveSignalInbox(items);
  await renderSignalInlineChart(sig);
};

window.setSignalChartTimeframe = async (id, tf) => {
  signalChartTfState[id] = tf;
  const panel = document.getElementById(`signalChartPanel-${id}`);
  document.querySelectorAll(`[data-sig-chart="${id}"]`).forEach(b => b.classList.toggle('active', b.dataset.sigTf === tf));
  if (!panel || panel.style.display === 'none') return;
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  await renderSignalInlineChart(sig);
};

window.signalOpenChart = async id => {
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  await signalHydrateMarket(sig);
  saveSignalInbox(items);
  const p = sig?.parsed || {};
  const info = signalChartInfo(sig);
  if (!info) { toast('La señal necesita ticker para abrir Charts.', 'error'); return; }
  const aiSym = document.getElementById('aiSymbol');
  if (aiSym) aiSym.value = info.symbol;
  window._aiSource = info.source;
  window._aiType = info.type;
  mainChartState.symbol = info.symbol;
  if (typeof setMarketType === 'function') setMarketType(p.dir === 'spot' ? 'spot' : 'futures');
  const selectedTargets = signalOperationalTargets(sig);
  _analysisTradeData = {
    ticker: info.raw,
    dir: p.dir || 'long',
    exchange: p.exchange || 'BINANCE',
    leverage: p.leverage || 1,
    entry: p.entry || 0,
    sl: p.sl || 0,
    tp1: selectedTargets[0] || 0,
    tp2: selectedTargets[1] || 0,
    tp3: selectedTargets[2] || 0,
    signalTime: signalOriginalTime(sig),
    notes: sig.raw || '',
  };
  window.showPage('analysis');
  showChartsTab('graficos');
  setTimeout(() => loadCharts(), 120);
};

window.signalConvert = async (id, status) => {
  const items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  await signalHydrateMarket(sig);
  saveSignalInbox(items);
  if (!applySignalToCalculator(sig)) return;
  try {
    await window.saveTrade(status);
    sig.status = 'converted';
    sig.convertedAt = new Date().toISOString();
    sig.convertedTo = status;
    saveSignalStateRemote(sig, { status:'converted', convertedAt:sig.convertedAt, convertedTo:status });
    saveSignalInbox(items);
    renderSignals();
    updateNavAlertBadges?.();
  } catch(e) {
    toast('No pude convertir la señal: ' + e.message, 'error');
  }
};

window.discardSignal = async id => {
  let items = loadSignalInbox();
  const sig = items.find(x => x.id === id);
  if (sig?.status === 'discarded') {
    sig.status = 'cleared';
    sig.clearedAt = new Date().toISOString();
    await saveSignalStateRemoteAsync(sig, { status:'cleared', clearedAt:sig.clearedAt }).catch(()=>{});
    items = items.filter(x => x.id !== id);
  }
  else if (sig) {
    sig.status = 'discarded';
    sig.discardedAt = new Date().toISOString();
    await saveSignalStateRemoteAsync(sig, { status:'discarded', discardedAt:sig.discardedAt }).catch(()=>{});
  }
  saveSignalInbox(pruneSignalInbox(items));
  renderSignals();
  updateNavAlertBadges?.();
};

window.clearSignalInbox = async () => {
  const items = loadSignalInbox();
  const discarded = items.filter(x => signalStatusKey(x) === 'discarded');
  if (!discarded.length) {
    toast('No hay señales descartadas para limpiar.');
    return;
  }
  if (!confirm(`¿Limpiar ${discarded.length} señal${discarded.length === 1 ? '' : 'es'} descartada${discarded.length === 1 ? '' : 's'}?`)) return;
  const clearedAt = new Date().toISOString();
  await Promise.all(discarded.map(sig => {
    sig.status = 'cleared';
    sig.clearedAt = clearedAt;
    return saveSignalStateRemoteAsync(sig, { status:'cleared', clearedAt }).catch(()=>{});
  }));
  saveSignalInbox(pruneSignalInbox(items.filter(x => signalStatusKey(x) !== 'discarded')));
  renderSignals();
  updateNavAlertBadges?.();
  toast('Señales descartadas limpiadas.');
};

window.clearAllSignalInbox = async () => {
  const items = loadSignalInbox();
  if (!items.length) {
    toast('No hay senales para limpiar.');
    return;
  }
  if (!confirm('Limpiar todas las senales del Signal Desk? Esto no borra trades, historial, posiciones ni ordenes.')) return;
  const clearedAt = new Date().toISOString();
  await Promise.all(items.map(sig => {
    sig.status = 'cleared';
    sig.clearedAt = clearedAt;
    return saveSignalStateRemoteAsync(sig, { status:'cleared', clearedAt }).catch(()=>{});
  }));
  saveSignalInbox([]);
  renderSignals();
  updateNavAlertBadges?.();
  toast('Signal Desk limpiado. Trades e historial no fueron modificados.');
};
