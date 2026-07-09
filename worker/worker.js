/**
 * MAUex Cloudflare Worker v3
 * 
 * SETUP EN CLOUDFLARE DASHBOARD:
 * 1. Workers & Pages → tu worker → Settings → Variables:
 *    BINANCE_KEY, BINANCE_SECRET
 *    BYBIT_KEY, BYBIT_SECRET
 *    OKX_KEY, OKX_SECRET, OKX_PASSPHRASE
 *    MEXC_KEY, MEXC_SECRET
 *
 * 2. Workers & Pages → tu worker → Settings → KV Namespaces:
 *    Bind: MAUEX_CACHE (crear namespace primero en KV section)
 *
 * 3. Workers & Pages → tu worker → Settings → Triggers → Cron:
 *    Agregar: * * * * * (cada minuto)
 */

const DEFAULT_ALLOWED_ORIGIN = 'https://mauex.vercel.app';
const ERROR_LOG_KV_KEY = 'errors_log';
const EXCHANGE_COOLDOWN_PREFIX = 'exchange_cooldown_';
const READER_HEARTBEAT_KV_KEY = 'reader_heartbeat';
const ERROR_LOG_LIMIT = 100;
const PROXY_ALLOWED_HOSTS = new Set([
  'api.binance.com',
  'fapi.binance.com',
  'data-api.binance.vision',
  'api.bybit.com',
  'www.okx.com',
  'api.mexc.com',
  'contract.mexc.com',
  'api.kucoin.com',
  'api-futures.kucoin.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
]);

function requestOriginAllowed(origin, env) {
  if (!origin) return true;
  const allowed = (env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN).trim();
  if (origin === allowed) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': requestOriginAllowed(origin, env) ? (origin || (env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN)) : (env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token',
    'Vary': 'Origin',
  };
}

function errorMessage(error) {
  return String(error?.message || error || 'Error desconocido').slice(0, 500);
}

function proxyTargetAllowed(target) {
  return target?.protocol === 'https:' && PROXY_ALLOWED_HOSTS.has(target.hostname.toLowerCase());
}

async function handleProxyRequest(request, url, json, cors) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const rawTarget = url.searchParams.get('url') || '';
  let target;
  try {
    target = new URL(rawTarget);
  } catch(e) {
    return json({ error: 'URL invalida' }, 400);
  }
  if (!proxyTargetAllowed(target)) {
    return json({ error: 'proxy target not allowed', host: target.hostname || '' }, 403);
  }

  const upstreamHeaders = new Headers();
  [
    'accept',
    'x-mbx-apikey',
    'x-bapi-api-key',
    'x-bapi-timestamp',
    'x-bapi-sign',
    'x-bapi-recv-window',
    'ok-access-key',
    'ok-access-sign',
    'ok-access-timestamp',
    'ok-access-passphrase',
    'kc-api-key',
    'kc-api-sign',
    'kc-api-timestamp',
    'kc-api-passphrase',
    'kc-api-key-version',
  ].forEach(name => {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  });
  if (!upstreamHeaders.has('accept')) upstreamHeaders.set('accept', 'application/json,text/plain,*/*');
  if (/\.finance\.yahoo\.com$/i.test(target.hostname)) {
    upstreamHeaders.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36');
    upstreamHeaders.set('accept-language', 'en-US,en;q=0.9,es;q=0.8');
    upstreamHeaders.set('cache-control', 'no-cache');
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(20000),
    });
    const outHeaders = new Headers(cors);
    outHeaders.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    outHeaders.set('Cache-Control', 'no-store');
    const body = await upstream.arrayBuffer();
    return new Response(body, { status: upstream.status, headers: outHeaders });
  } catch(e) {
    return json({ error: 'proxy fetch failed', message: errorMessage(e) }, 502);
  }
}

async function appendErrorLog(env, entry = {}) {
  if (!env.MAUEX_CACHE) return;
  try {
    let current = [];
    const raw = await env.MAUEX_CACHE.get(ERROR_LOG_KV_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) current = parsed;
      } catch(e) {}
    }
    const next = {
      ts: new Date().toISOString(),
      exchange: String(entry.exchange || entry.service || 'worker').toUpperCase(),
      endpoint: entry.endpoint || '',
      message: errorMessage(entry.message || entry.error),
      status: entry.status || null,
      phase: entry.phase || '',
    };
    const recentDuplicate = current.find(e =>
      String(e.exchange || '').toUpperCase() === next.exchange &&
      String(e.phase || '') === next.phase &&
      String(e.message || '') === next.message &&
      Date.now() - (Date.parse(e.ts || '') || 0) < 15 * 60 * 1000
    );
    if (recentDuplicate) return;
    current.unshift(next);
    await env.MAUEX_CACHE.put(ERROR_LOG_KV_KEY, JSON.stringify(current.slice(0, ERROR_LOG_LIMIT)), { expirationTtl: 7 * 24 * 60 * 60 });
  } catch(e) {
    console.error('appendErrorLog failed', e?.message || e);
  }
}

async function logBalanceErrors(env, errors = {}, phase = 'balance') {
  await Promise.all(Object.entries(errors || {}).map(([exchange, message]) =>
    appendErrorLog(env, { exchange, message, phase })
  ));
}

async function readErrorLog(env) {
  if (!env.MAUEX_CACHE) return [];
  try {
    const raw = await env.MAUEX_CACHE.get(ERROR_LOG_KV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, ERROR_LOG_LIMIT) : [];
  } catch(e) {
    return [];
  }
}

function countErrorsSince(errors, sinceMs) {
  return (errors || []).filter(e => {
    const ts = Date.parse(e?.ts || 0);
    return Number.isFinite(ts) && ts >= sinceMs;
  }).length;
}

function exchangeCooldownForError(exchange, message = '') {
  const ex = String(exchange || '').toUpperCase();
  const msg = String(message || '');
  if (/429|rate limit|too many requests|code:?\s*1015/i.test(msg)) {
    return {
      ms: ex === 'OKX' ? 60 * 60 * 1000 : 10 * 60 * 1000,
      reason: 'rate limit temporal',
    };
  }
  if (ex === 'KUCOIN' && /timeout|timed out|aborted/i.test(msg)) {
    return {
      ms: 20 * 60 * 1000,
      reason: 'timeout temporal de Oracle',
    };
  }
  if (ex === 'MEXC' && /402|api key expired|apply again|key expired/i.test(msg)) {
    return {
      ms: 12 * 60 * 60 * 1000,
      reason: 'API key vencida',
    };
  }
  return null;
}

async function readExchangeCooldown(env, exchange) {
  if (!env.MAUEX_CACHE) return null;
  const key = EXCHANGE_COOLDOWN_PREFIX + String(exchange || '').toUpperCase();
  try {
    const raw = await env.MAUEX_CACHE.get(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const untilMs = Date.parse(data?.until || '');
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
      await env.MAUEX_CACHE.delete(key);
      return null;
    }
    return data;
  } catch(e) {
    return null;
  }
}

async function setExchangeCooldown(env, exchange, message = '') {
  if (!env.MAUEX_CACHE) return null;
  const cooldown = exchangeCooldownForError(exchange, message);
  if (!cooldown) return null;
  const payload = {
    exchange: String(exchange || '').toUpperCase(),
    reason: cooldown.reason,
    message: errorMessage(message),
    until: new Date(Date.now() + cooldown.ms).toISOString(),
  };
  await env.MAUEX_CACHE.put(
    EXCHANGE_COOLDOWN_PREFIX + payload.exchange,
    JSON.stringify(payload),
    { expirationTtl: Math.ceil(cooldown.ms / 1000) + 60 }
  );
  return payload;
}

async function clearExchangeCooldown(env, exchange) {
  if (!env.MAUEX_CACHE) return false;
  await env.MAUEX_CACHE.delete(EXCHANGE_COOLDOWN_PREFIX + String(exchange || '').toUpperCase());
  return true;
}

async function exchangeCooldownActive(env, exchange) {
  const cooldown = await readExchangeCooldown(env, exchange);
  if (!cooldown) return null;
  return {
    positions: [],
    orders: [],
    error: null,
    skipped: true,
    cooldown,
  };
}

async function readActiveExchangeCooldowns(env, exchanges = []) {
  const entries = await Promise.all(
    exchanges.map(async exchange => [exchange, await readExchangeCooldown(env, exchange)])
  );
  return Object.fromEntries(entries.filter(([, cooldown]) => !!cooldown));
}

function isExpectedCooldownError(error, cooldowns = {}) {
  const exchange = String(error?.exchange || error?.service || '').toUpperCase();
  const message = String(error?.message || '');
  const cooldown = cooldowns[exchange];
  if (!cooldown) return false;
  if (/rate limit/i.test(cooldown.reason || '') && /429|rate limit|too many requests|code:?\s*1015/i.test(message)) return true;
  if (/timeout/i.test(cooldown.reason || '') && /timeout|timed out|aborted/i.test(message)) return true;
  return false;
}

function filterOpsHealthErrors(errors = [], { oracleOk = false } = {}) {
  return (errors || []).filter(e => {
    const exchange = String(e?.exchange || e?.service || '').toUpperCase();
    const message = String(e?.message || '');
    if (oracleOk && exchange === 'BINANCE' && /Railway:\s*404/i.test(message)) return false;
    return true;
  });
}

function normalizedOpsErrorMessage(exchange, message) {
  const ex = String(exchange || '').toUpperCase();
  const msg = String(message || '');
  if (/429|rate limit|too many requests|code:?\s*1015/i.test(msg)) return `${ex} rate limit`;
  if (ex === 'KUCOIN' && /timeout|timed out|aborted/i.test(msg)) return 'KUCOIN timeout Oracle';
  if (ex === 'MEXC' && /402|api key expired|apply again|key expired/i.test(msg)) return 'MEXC API key vencida';
  return msg;
}

function uniqueOpsHealthErrors(errors = []) {
  const seen = new Set();
  const out = [];
  for (const e of errors || []) {
    const exchange = String(e?.exchange || '').toUpperCase();
    const key = [
      exchange,
      String(e?.service || '').toUpperCase(),
      String(e?.phase || ''),
      normalizedOpsErrorMessage(exchange, e?.message || ''),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function readReaderHeartbeat(env) {
  if (!env.MAUEX_CACHE) return null;
  try {
    const raw = await env.MAUEX_CACHE.get(READER_HEARTBEAT_KV_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const lastSeenMs = Date.parse(data?.ts || 0);
    const ageMs = Number.isFinite(lastSeenMs) ? Date.now() - lastSeenMs : null;
    return {
      ts: data.ts || null,
      source: data.source || 'telegram-reader',
      status: data.status || 'alive',
      ageMs,
      alive: ageMs != null && ageMs <= 10 * 60 * 1000,
    };
  } catch(e) {
    return null;
  }
}

async function writeReaderHeartbeat(env, payload = {}) {
  if (!env.MAUEX_CACHE) throw new Error('MAUEX_CACHE KV no configurado');
  const heartbeat = {
    ts: new Date().toISOString(),
    source: String(payload.source || 'telegram-reader').slice(0, 80),
    status: String(payload.status || 'alive').slice(0, 40),
    version: String(payload.version || '').slice(0, 80),
  };
  await env.MAUEX_CACHE.put(READER_HEARTBEAT_KV_KEY, JSON.stringify(heartbeat), { expirationTtl: 30 * 60 });
  return heartbeat;
}

async function readCachedSummary(env) {
  if (!env.MAUEX_CACHE) return null;
  try {
    const raw = await env.MAUEX_CACHE.get('summary');
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

function cachedExchangeBalance(summary, exchange, cooldown = null) {
  const ex = String(exchange || '').toUpperCase();
  const balance = summary?.balances?.[ex];
  if (!balance) return null;
  return {
    ...balance,
    stale: true,
    staleReason: cooldown?.reason || 'dato cacheado',
    cooldown: cooldown || null,
  };
}

function cachedExchangeRows(summary, exchange, key) {
  const ex = String(exchange || '').toUpperCase();
  return (Array.isArray(summary?.[key]) ? summary[key] : []).filter(row => {
    const rowExchange = String(row?.exchange || row?.exchangeSource || '').toUpperCase();
    return rowExchange === ex;
  });
}

async function checkServiceHealth(env, name, baseUrl) {
  const url = String(baseUrl || '').replace(/\/+$/, '');
  if (!url) return { configured: false, ok: null, status: null, message: 'sin URL' };
  try {
    const r = await backendFetch(env, `${url}/health`, { timeoutMs: 8000 });
    const ok = !!(r.ok && r.data && !r.data.error);
    return {
      configured: true,
      ok,
      status: r.status || 0,
      message: ok ? (r.data.status || 'ok') : (r.data?.error || r.raw || `HTTP ${r.status || 0}`),
      service: r.data?.service || name,
    };
  } catch(e) {
    await appendErrorLog(env, { service: name, phase: 'service-health', message: e.message });
    return { configured: true, ok: false, status: 0, message: e.message, service: name };
  }
}

async function buildOpsHealth(env) {
  const [summary, errors, reader] = await Promise.all([
    readCachedSummary(env),
    readErrorLog(env),
    readReaderHeartbeat(env),
  ]);
  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const [oracle, railway] = await Promise.all([
    checkServiceHealth(env, 'oracle', env.BINANCE_BACKEND_URL || env.ORACLE_BACKEND_URL || ''),
    checkServiceHealth(env, 'railway', env.RAILWAY_URL || ''),
  ]);
  const cooldowns = await readActiveExchangeCooldowns(env, ['OKX', 'KUCOIN', 'MEXC']);
  const visibleErrors = uniqueOpsHealthErrors(
    filterOpsHealthErrors(errors, { oracleOk: !!oracle.ok })
      .filter(error => !isExpectedCooldownError(error, cooldowns))
  );
  return {
    ok: true,
    worker: { status: 'ok', version: WORKER_VERSION },
    lastSync: summary?.lastSync || null,
    cacheSavedAt: summary?.cacheSavedAt || null,
    errors24h: countErrorsSince(visibleErrors, since24h),
    totalErrors: visibleErrors.length,
    latestErrors: visibleErrors.slice(0, 5),
    reader,
    services: { oracle, railway },
    cooldowns,
  };
}

async function fetchBalancesV2(env) {
  const balances = {};
  const errors = {};

  const backendUrl = (env.BINANCE_BACKEND_URL || '').trim();
  if (backendUrl) {
    try {
      const r = await backendFetch(env, `${backendUrl}/binance-balance`);
      if (r.ok && r.data && !r.data.error) balances.BINANCE = normalizeBalance(r.data);
      else errors.BINANCE = `Oracle: ${r.data?.error || r.raw || r.status}`;
    } catch(e) { errors.BINANCE = `Oracle: ${e.message}`; }
  }

  const railwayUrl = (env.RAILWAY_URL || '').trim();
  if (!balances.BINANCE && railwayUrl) {
    try {
      const r = await backendFetch(env, `${railwayUrl}/binance-balance`);
      if (r.ok && r.data && !r.data.error) balances.BINANCE = normalizeBalance(r.data);
      else errors.BINANCE = `Railway: ${r.data?.error || r.raw || r.status}`;
    } catch(e) { errors.BINANCE = `Railway: ${e.message}`; }
  }

  const bybitKey = (env.BYBIT_KEY || '').trim();
  const bybitSec = (env.BYBIT_SECRET || '').trim();
  if (bybitKey && bybitSec) {
    try {
      const bybitBalance = async (accountType) => {
        const ts = Date.now().toString();
        const q = `accountType=${accountType}&coin=USDT,USDC`;
        const msg = ts + bybitKey + '5000' + q;
        const sig = await hmac256(bybitSec, msg);
        return safeFetch(`https://api.bybit.com/v5/account/wallet-balance?${q}`, {
          headers: { 'X-BAPI-API-KEY': bybitKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': '5000' },
        });
      };
      let r = await bybitBalance('UNIFIED');
      if (!r.ok || r.data?.retCode !== 0) r = await bybitBalance('CONTRACT');
      if (r.ok && r.data?.retCode === 0) {
        let total = 0, free = 0, margin = 0, orders = 0, pnl = 0;
        let totalUsdt = 0, totalUsdc = 0;
        for (const account of (r.data.result?.list || [])) {
          const accountPnl = parseFloat(account.totalPerpUPL || 0);
          const accountEquity = parseFloat(account.totalEquity || 0);
          const accountMarginBalance = parseFloat(account.totalMarginBalance || 0);
          const accountWallet = parseFloat(account.totalWalletBalance || 0);
          const accountTotal = accountEquity || accountMarginBalance || (accountWallet ? accountWallet + accountPnl : 0);
          const accountAvailable = parseFloat(account.totalAvailableBalance || 0);
          const accountIM = parseFloat(account.totalInitialMargin || 0);
          let accountOrders = 0;
          let accountPositionMargin = 0;
          for (const c of (account.coin || [])) {
            const usdValue = parseFloat(c.usdValue || c.equity || c.walletBalance || 0);
            if (c.coin === 'USDT') totalUsdt += usdValue;
            if (c.coin === 'USDC') totalUsdc += usdValue;
            accountOrders += parseFloat(c.totalOrderIM || 0);
            accountPositionMargin += parseFloat(c.totalPositionIM || 0);
          }
          orders += accountOrders;
          const accountMargin = accountPositionMargin || Math.max(0, accountIM - accountOrders);
          total += accountTotal;
          margin += accountMargin;
          free += accountAvailable || Math.max(0, accountTotal - accountMargin - accountOrders - accountPnl);
          pnl += accountPnl;
        }
        const fallbackTotal = totalUsdt + totalUsdc + (total ? 0 : pnl);
        balances.BYBIT = normalizeBalance({ total: total || fallbackTotal, free, margin, orders, pnl, USDT: totalUsdt, USDC: totalUsdc });
      } else {
        errors.BYBIT = r.data?.retMsg || `${r.status}`;
      }
    } catch(e) { errors.BYBIT = e.message; }
  }

  const okxKey = (env.OKX_KEY || '').trim();
  const okxSec = (env.OKX_SECRET || '').trim();
  const okxPass = (env.OKX_PASSPHRASE || '').trim();
  if (okxKey && okxSec && okxPass) {
    const okxCooldown = await readExchangeCooldown(env, 'OKX');
    if (okxCooldown) {
      const cached = cachedExchangeBalance(await readCachedSummary(env), 'OKX', okxCooldown);
      if (cached) balances.OKX = cached;
      else errors.OKX = `OKX en pausa: ${okxCooldown.reason}`;
    } else try {
      const okxGet = async (path) => {
        const ts = new Date().toISOString();
        const key2 = await crypto.subtle.importKey('raw', new TextEncoder().encode(okxSec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key2, new TextEncoder().encode(ts + 'GET' + path));
        const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
        return safeFetch(`https://www.okx.com${path}`, {
          headers: { 'OK-ACCESS-KEY': okxKey, 'OK-ACCESS-SIGN': b64, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': okxPass, 'Content-Type': 'application/json' },
        });
      };
      const num = (...vals) => {
        for (const v of vals) {
          const n = Number(v);
          if (Number.isFinite(n)) return n;
        }
        return 0;
      };
      let total = 0, free = 0, margin = 0, orders = 0, pnl = 0;
      let totalUsdt = 0, totalUsdc = 0;
      const r1 = await okxGet('/api/v5/account/balance?ccy=USDT,USDC');
      if (r1.ok && r1.data?.code === '0') {
        const account = r1.data.data?.[0] || {};
        total += num(account.totalEq, account.adjEq);
        for (const d of (account.details || [])) {
          const eq = num(d.eq, d.eqUsd, d.disEq, d.cashBal, d.availBal);
          const available = num(d.availEq, d.availBal, d.cashBal);
          free += available;
          margin += num(d.imr);
          orders += num(d.ordFrozen, d.frozenBal);
          pnl += num(d.upl);
          if (d.ccy === 'USDT') totalUsdt += eq;
          if (d.ccy === 'USDC') totalUsdc += eq;
        }
      }
      const r2 = await okxGet('/api/v5/asset/balances?ccy=USDT,USDC');
      if (r2.ok && r2.data?.code === '0') {
        for (const b of (r2.data.data || [])) {
          const bal = num(b.bal, b.availBal);
          const avail = num(b.availBal, bal);
          total += bal;
          free += avail;
          if (b.ccy === 'USDT') totalUsdt += bal;
          if (b.ccy === 'USDC') totalUsdc += bal;
        }
      }
      let positionPnl = 0, positionMargin = 0;
      const r3 = await okxGet('/api/v5/account/positions');
      if (r3.ok && r3.data?.code === '0') {
        for (const p of (r3.data.data || []).filter(p => num(p.pos) !== 0)) {
          positionPnl += num(p.upl);
          positionMargin += num(p.margin, p.imr, Math.abs(num(p.notionalUsd)) / Math.max(1, num(p.lever) || 1));
        }
      }
      if (positionPnl) pnl = positionPnl;
      if (positionMargin) margin = Math.max(margin, positionMargin);
      if (pnl) total += pnl;
      balances.OKX = normalizeBalance({ total: total || totalUsdt + totalUsdc, free, margin, orders, pnl, USDT: totalUsdt, USDC: totalUsdc });
      if (!r1.ok && !r2.ok) errors.OKX = r1.data?.msg || `${r1.status}`;
      else if ((total || totalUsdt + totalUsdc || free || margin || orders || pnl) <= 0) errors.OKX = 'OKX respondio sin saldos USDT/USDC utilizables';
    } catch(e) { errors.OKX = e.message; }
    if (errors.OKX && !okxCooldown) await setExchangeCooldown(env, 'OKX', errors.OKX);
  }

  const mexcKey = (env.MEXC_KEY || '').trim();
  const mexcSec = (env.MEXC_SECRET || '').trim();
  if (mexcKey && mexcSec) {
    const mexcCooldown = await readExchangeCooldown(env, 'MEXC');
    if (!mexcCooldown) try {
      let total = 0, free = 0, margin = 0, orders = 0, pnl = 0;
      let totalUsdt = 0, totalUsdc = 0;
      const ts1 = Date.now().toString();
      const sig1 = await hmac256(mexcSec, mexcKey + ts1);
      const r1 = await safeFetch('https://contract.mexc.com/api/v1/private/account/assets', {
        headers: { 'ApiKey': mexcKey, 'Request-Time': ts1, 'Signature': sig1, 'Content-Type': 'application/json' },
      });
      if (r1.ok && r1.data?.success) {
        for (const a of (r1.data.data || [])) {
          const equity = parseFloat(a.equity || a.cashBalance || a.availableBalance || 0);
          const available = parseFloat(a.availableBalance || 0);
          total += equity;
          free += available;
          margin += parseFloat(a.positionMargin || 0);
          orders += parseFloat(a.frozenBalance || 0);
          pnl += parseFloat(a.unrealized || a.unrealisedPnl || 0);
          if (a.currency === 'USDT') totalUsdt += equity;
          if (a.currency === 'USDC') totalUsdc += equity;
        }
      }
      const ts2 = Date.now().toString();
      const q2 = `timestamp=${ts2}`;
      const sig2 = await hmac256(mexcSec, q2);
      const r2 = await safeFetch(`https://api.mexc.com/api/v3/account?${q2}&signature=${sig2}`, { headers: { 'X-MEXC-APIKEY': mexcKey } });
      if (r2.ok && r2.data?.balances) {
        for (const b of r2.data.balances) {
          if (b.asset !== 'USDT' && b.asset !== 'USDC') continue;
          const spotFree = parseFloat(b.free || 0);
          const spotLocked = parseFloat(b.locked || 0);
          const spotTotal = spotFree + spotLocked;
          total += spotTotal;
          free += spotFree;
          orders += spotLocked;
          if (b.asset === 'USDT') totalUsdt += spotTotal;
          if (b.asset === 'USDC') totalUsdc += spotTotal;
        }
      }
      balances.MEXC = normalizeBalance({ total: total || totalUsdt + totalUsdc, free, margin, orders, pnl, USDT: totalUsdt, USDC: totalUsdc });
      if (!r1.ok && !r2.ok) errors.MEXC = r1.data?.message || `${r1.status}`;
    } catch(e) { errors.MEXC = e.message; }
    if (errors.MEXC) await setExchangeCooldown(env, 'MEXC', errors.MEXC);
  }

  const kucoinBackendUrl = (env.KUCOIN_BACKEND_URL || env.BINANCE_BACKEND_URL || '').trim();
  if (kucoinBackendUrl) {
    const kucoinCooldown = await readExchangeCooldown(env, 'KUCOIN');
    if (!kucoinCooldown) try {
      const r = await backendFetch(env, `${kucoinBackendUrl}/kucoin-balance`, { timeoutMs: 30000 });
      if (r.ok && r.data && !r.data.error) balances.KUCOIN = normalizeBalance(r.data);
      else errors.KUCOIN = `Oracle: ${r.data?.error || r.raw || r.status}`;
    } catch(e) { errors.KUCOIN = `Oracle: ${e.message}`; }
    if (errors.KUCOIN) await setExchangeCooldown(env, 'KUCOIN', errors.KUCOIN);
  }

  const ibkrBackendUrl = (env.IBKR_BACKEND_URL || env.BINANCE_BACKEND_URL || '').trim();
  if (ibkrBackendUrl) {
    try {
      const r = await backendFetch(env, `${ibkrBackendUrl}/ibkr-balance`);
      if (r.ok && r.data && !r.data.error) balances.IBKR = normalizeBalance(r.data);
      else errors.IBKR = `Oracle: ${r.data?.error || r.raw || r.status}`;
    } catch(e) { errors.IBKR = `Oracle: ${e.message}`; }
  }

  let totalUsdt = 0, totalUsdc = 0, totalEquity = 0;
  for (const b of Object.values(balances)) {
    totalUsdt += b.USDT || 0;
    totalUsdc += b.USDC || 0;
    totalEquity += b.total || 0;
  }

  const totals = {
    USDT: Math.round(totalUsdt * 100) / 100,
    USDC: Math.round(totalUsdc * 100) / 100,
    total: Math.round((totalEquity || totalUsdt + totalUsdc) * 100) / 100,
  };

  return {
    balances,
    totals,
    liquidity: totals,
    errors,
  };
}

const WORKER_VERSION = '2026-07-08-okx-cooldown-final-v10';
const TELEGRAM_KV_KEY = 'telegram_signals';

// ── HMAC-SHA256 (Web Crypto API) ─────────────────────────────────────────────
async function hmac256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Safe fetch (returns parsed JSON or null) ─────────────────────────────────
async function safeFetch(url, opts = {}) {
  try {
    const timeoutMs = Number(opts.timeoutMs || 15000);
    const { timeoutMs: _timeoutMs, ...fetchOpts } = opts;
    const r    = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    try {
      return { ok: r.ok, status: r.status, data: JSON.parse(text) };
    } catch(e) {
      return { ok: false, status: r.status, data: null, raw: text.slice(0, 300) };
    }
  } catch(e) {
    return { ok: false, status: 0, data: null, raw: e.message };
  }
}

function authHeaders(env, headers = {}) {
  const token = (env.MAUEX_API_TOKEN || '').trim();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

function backendFetch(env, url, opts = {}) {
  return safeFetch(url, {
    ...opts,
    headers: authHeaders(env, opts.headers || {}),
  });
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ''));
  const right = new TextEncoder().encode(String(b || ''));
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

function apiTokenOk(request, env) {
  const expected = (env.MAUEX_API_TOKEN || '').trim();
  if (!expected) return false;
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return constantTimeEqual(got, expected);
}

async function diagnoseOKXBalance(env) {
  const okxKey = (env.OKX_KEY || '').trim();
  const okxSec = (env.OKX_SECRET || '').trim();
  const okxPass = (env.OKX_PASSPHRASE || '').trim();
  const has = { key: !!okxKey, secret: !!okxSec, passphrase: !!okxPass };
  if (!okxKey || !okxSec || !okxPass) {
    return { ok: false, has, error: 'Faltan OKX_KEY / OKX_SECRET / OKX_PASSPHRASE' };
  }

  const okxGet = async (path) => {
    const ts = new Date().toISOString();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(okxSec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts + 'GET' + path));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return safeFetch(`https://www.okx.com${path}`, {
      timeoutMs: 12000,
      headers: {
        'OK-ACCESS-KEY': okxKey,
        'OK-ACCESS-SIGN': b64,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': okxPass,
        'Content-Type': 'application/json',
      },
    });
  };

  const num = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const summarize = r => ({
    ok: !!r.ok,
    status: r.status,
    code: String(r.data?.code || ''),
    msg: String(r.data?.msg || r.data?.message || r.raw || '').slice(0, 180),
    rows: Array.isArray(r.data?.data) ? r.data.data.length : 0,
    detailRows: Array.isArray(r.data?.data?.[0]?.details) ? r.data.data[0].details.length : 0,
  });

  const account = await okxGet('/api/v5/account/balance?ccy=USDT,USDC');
  const funding = await okxGet('/api/v5/asset/balances?ccy=USDT,USDC');
  const accountAll = await okxGet('/api/v5/account/balance');
  const fundingAll = await okxGet('/api/v5/asset/balances');
  const valuation = await okxGet('/api/v5/asset/asset-valuation?ccy=USD');
  const positions = await okxGet('/api/v5/account/positions');
  let total = 0, free = 0, margin = 0, orders = 0, pnl = 0, USDT = 0, USDC = 0;
  const currencies = new Set();
  const nonZeroAccount = [];
  const nonZeroFunding = [];

  if (account.ok && account.data?.code === '0') {
    const a = account.data.data?.[0] || {};
    total += num(a.totalEq, a.adjEq);
    for (const d of (a.details || [])) {
      currencies.add(d.ccy);
      const eq = num(d.eq, d.eqUsd, d.disEq, d.cashBal, d.availBal);
      free += num(d.availEq, d.availBal, d.cashBal);
      margin += num(d.imr);
      orders += num(d.ordFrozen, d.frozenBal);
      pnl += num(d.upl);
      if (d.ccy === 'USDT') USDT += eq;
      if (d.ccy === 'USDC') USDC += eq;
    }
  }
  if (accountAll.ok && accountAll.data?.code === '0') {
    for (const d of (accountAll.data.data?.[0]?.details || [])) {
      const eq = num(d.eq, d.eqUsd, d.disEq, d.cashBal, d.availBal);
      const available = num(d.availEq, d.availBal, d.cashBal);
      const linePnl = num(d.upl);
      const imr = num(d.imr);
      const ordFrozen = num(d.ordFrozen, d.frozenBal);
      if (eq || available || linePnl || imr || ordFrozen) {
        nonZeroAccount.push({
          ccy: d.ccy,
          eq: Math.round(eq * 100) / 100,
          available: Math.round(available * 100) / 100,
          upl: Math.round(linePnl * 100) / 100,
          margin: Math.round(imr * 100) / 100,
          orders: Math.round(ordFrozen * 100) / 100,
        });
      }
    }
  }
  if (funding.ok && funding.data?.code === '0') {
    for (const b of (funding.data.data || [])) {
      currencies.add(b.ccy);
      const bal = num(b.bal, b.availBal);
      total += bal;
      free += num(b.availBal, bal);
      if (b.ccy === 'USDT') USDT += bal;
      if (b.ccy === 'USDC') USDC += bal;
    }
  }
  if (fundingAll.ok && fundingAll.data?.code === '0') {
    for (const b of (fundingAll.data.data || [])) {
      const bal = num(b.bal, b.availBal);
      const avail = num(b.availBal, bal);
      if (bal || avail) {
        nonZeroFunding.push({
          ccy: b.ccy,
          bal: Math.round(bal * 100000000) / 100000000,
          available: Math.round(avail * 100000000) / 100000000,
        });
      }
    }
  }
  let positionPnl = 0, positionMargin = 0;
  if (positions.ok && positions.data?.code === '0') {
    for (const p of (positions.data.data || []).filter(p => num(p.pos) !== 0)) {
      positionPnl += num(p.upl);
      positionMargin += num(p.margin, p.imr, Math.abs(num(p.notionalUsd)) / Math.max(1, num(p.lever) || 1));
    }
  }
  if (positionPnl) pnl = positionPnl;
  if (positionMargin) margin = Math.max(margin, positionMargin);
  if (pnl) total += pnl;

  return {
    ok: account.ok || funding.ok || positions.ok,
    has,
    account: summarize(account),
    funding: summarize(funding),
    accountAll: summarize(accountAll),
    fundingAll: summarize(fundingAll),
    valuation: {
      ...summarize(valuation),
      totalBal: Number(valuation.data?.data?.[0]?.totalBal ?? valuation.data?.data?.totalBal ?? 0) || 0,
      details: valuation.data?.data?.[0] || valuation.data?.data || null,
    },
    positions: summarize(positions),
    currencies: [...currencies].filter(Boolean).sort(),
    nonZeroAccount: nonZeroAccount.slice(0, 30),
    nonZeroFunding: nonZeroFunding.slice(0, 30),
    totalIncludesUnrealizedPnl: true,
    totals: normalizeBalance({ total: total || USDT + USDC, free, margin, orders, pnl, USDT, USDC }),
  };
}

async function diagnoseBybitBalance(env) {
  const bybitKey = (env.BYBIT_KEY || '').trim();
  const bybitSec = (env.BYBIT_SECRET || '').trim();
  const has = { key: !!bybitKey, secret: !!bybitSec };
  if (!bybitKey || !bybitSec) {
    return { ok: false, has, error: 'Faltan BYBIT_KEY / BYBIT_SECRET' };
  }

  const bybitBalance = async (accountType) => {
    const ts = Date.now().toString();
    const q = `accountType=${accountType}&coin=USDT,USDC`;
    const msg = ts + bybitKey + '5000' + q;
    const sig = await hmac256(bybitSec, msg);
    return safeFetch(`https://api.bybit.com/v5/account/wallet-balance?${q}`, {
      timeoutMs: 12000,
      headers: {
        'X-BAPI-API-KEY': bybitKey,
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-SIGN': sig,
        'X-BAPI-RECV-WINDOW': '5000',
      },
    });
  };

  const num = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const summarize = r => ({
    ok: !!r.ok,
    status: r.status,
    retCode: r.data?.retCode ?? null,
    retMsg: String(r.data?.retMsg || r.raw || '').slice(0, 180),
    accounts: Array.isArray(r.data?.result?.list) ? r.data.result.list.length : 0,
  });

  const unified = await bybitBalance('UNIFIED');
  const contract = unified.ok && unified.data?.retCode === 0 ? null : await bybitBalance('CONTRACT');
  const pickedType = unified.ok && unified.data?.retCode === 0 ? 'UNIFIED' : 'CONTRACT';
  const picked = pickedType === 'UNIFIED' ? unified : contract;

  let total = 0, free = 0, margin = 0, orders = 0, pnl = 0, USDT = 0, USDC = 0;
  const accounts = [];
  if (picked?.ok && picked.data?.retCode === 0) {
    for (const account of (picked.data.result?.list || [])) {
      const accountPnl = num(account.totalPerpUPL);
      const accountEquity = num(account.totalEquity);
      const accountMarginBalance = num(account.totalMarginBalance);
      const accountWallet = num(account.totalWalletBalance);
      const accountTotal = accountEquity || accountMarginBalance || (accountWallet ? accountWallet + accountPnl : 0);
      const accountAvailable = num(account.totalAvailableBalance);
      const accountIM = num(account.totalInitialMargin);
      let accountOrders = 0;
      let accountPositionMargin = 0;
      let coinUSDT = 0;
      let coinUSDC = 0;
      for (const c of (account.coin || [])) {
        const usdValue = num(c.usdValue, c.equity, c.walletBalance);
        if (c.coin === 'USDT') { USDT += usdValue; coinUSDT += usdValue; }
        if (c.coin === 'USDC') { USDC += usdValue; coinUSDC += usdValue; }
        accountOrders += num(c.totalOrderIM);
        accountPositionMargin += num(c.totalPositionIM);
      }
      const accountMargin = accountPositionMargin || Math.max(0, accountIM - accountOrders);
      const accountDisplayFree = accountAvailable || Math.max(0, accountTotal - accountMargin - accountOrders - accountPnl);
      total += accountTotal;
      free += accountDisplayFree;
      margin += accountMargin;
      orders += accountOrders;
      pnl += accountPnl;
      accounts.push({
        totalEquity: Math.round(accountEquity * 100) / 100,
        totalMarginBalance: Math.round(accountMarginBalance * 100) / 100,
        totalWalletBalance: Math.round(accountWallet * 100) / 100,
        totalPerpUPL: Math.round(accountPnl * 100) / 100,
        calculatedTotal: Math.round(accountTotal * 100) / 100,
        totalAvailableBalance: Math.round(accountAvailable * 100) / 100,
        displayFree: Math.round(accountDisplayFree * 100) / 100,
        margin: Math.round(accountMargin * 100) / 100,
        orders: Math.round(accountOrders * 100) / 100,
        coinUSDT: Math.round(coinUSDT * 100) / 100,
        coinUSDC: Math.round(coinUSDC * 100) / 100,
        totalSource: accountEquity ? 'totalEquity' : accountMarginBalance ? 'totalMarginBalance' : accountWallet ? 'totalWalletBalance + totalPerpUPL' : 'coins fallback',
      });
    }
  }

  const fallbackTotal = USDT + USDC + (total ? 0 : pnl);
  return {
    ok: !!(picked?.ok && picked.data?.retCode === 0),
    has,
    pickedType,
    unified: summarize(unified),
    contract: contract ? summarize(contract) : null,
    accounts,
    totalIncludesUnrealizedPnl: true,
    totals: normalizeBalance({ total: total || fallbackTotal, free, margin, orders, pnl, USDT, USDC }),
  };
}

function telegramSecret(env) {
  return (env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_INBOX_SECRET || '').trim();
}

function telegramSecretOk(request, url, env) {
  const secret = telegramSecret(env);
  if (!secret) return false;
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || url.searchParams.get('secret') || '';
  return constantTimeEqual(got, secret);
}

async function loadTelegramSignals(env) {
  if (!env.MAUEX_CACHE) return [];
  try {
    const raw = await env.MAUEX_CACHE.get(TELEGRAM_KV_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch(e) {
    return [];
  }
}

async function saveTelegramSignals(env, signals) {
  if (!env.MAUEX_CACHE) throw new Error('MAUEX_CACHE KV no configurado');
  const compact = signals.slice(0, 250).map((sig, index) => {
    if (index < 8) return sig;
    const { imageBase64, ...rest } = sig || {};
    return rest;
  });
  await env.MAUEX_CACHE.put(TELEGRAM_KV_KEY, JSON.stringify(compact));
}

function telegramSourceName(msg = {}) {
  const fwd = msg.forward_origin || {};
  return msg.mauex_source_name
    || msg.mauexSourceName
    || fwd.chat?.title
    || msg.forward_from_chat?.title
    || msg.chat?.title
    || msg.chat?.username
    || msg.from?.username
    || msg.from?.first_name
    || 'Telegram';
}

function telegramOriginalDate(msg = {}) {
  const fwd = msg.forward_origin || {};
  const forwardedTs = Number(fwd.date || msg.forward_date || 0) || 0;
  const readerTs = msg.mauex_source === 'telegram-user-reader' ? (Number(msg.mauex_original_date || msg.date || 0) || 0) : 0;
  const ts = forwardedTs || readerTs;
  return ts ? new Date(ts * 1000).toISOString() : '';
}

function normalizeTelegramSignal(update = {}) {
  const msg = update.channel_post || update.edited_channel_post || update.message || update.edited_message || {};
  const raw = String(msg.text || msg.caption || '').trim();
  if (!raw) return null;
  const chatId = msg.chat?.id || msg.forward_from_chat?.id || msg.forward_origin?.chat?.id || 'telegram';
  const messageId = msg.message_id || update.update_id || Date.now();
  const sourceName = telegramSourceName(msg);
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const originalDate = telegramOriginalDate(msg);
  const messageDate = msg.date ? new Date(Number(msg.date) * 1000).toISOString() : '';
  return {
    id: `${chatId}:${messageId}`,
    telegramId: `${chatId}:${messageId}`,
    raw,
    source: 'telegram',
    sourceName,
    receivedAt: new Date().toISOString(),
    date: originalDate,
    signalTime: originalDate,
    originalMessageDate: originalDate,
    originalDateMissing: !originalDate,
    messageDate,
    hasImage: !!msg.mauex_has_image || !!photo || !!msg.document || !!msg.animation,
    imageFileId: photo?.file_id || msg.document?.file_id || '',
    imageWidth: Number(photo?.width || 0),
    imageHeight: Number(photo?.height || 0),
    imageMimeType: msg.mauex_image_mime || '',
    imageBytes: Number(msg.mauex_image_bytes || 0),
    imageBase64: msg.mauex_image_base64 || '',
    imageError: msg.mauex_image_error || '',
    imageSkipped: !!msg.mauex_image_skipped,
    providerSignalId: msg.mauex_provider_signal_id || '',
    messageKind: msg.mauex_message_kind || '',
  };
}

function normalizeInboxSignal(payload = {}) {
  const source = String(payload.source || '').trim().toLowerCase();
  if (!source || !['colony', 'telegram'].includes(source)) return null;
  const signalId = String(payload.signalId || payload.id || `${source}:${Date.now()}`).trim();
  const symbol = String(payload.symbol || payload.parsed?.ticker || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const ticker = String(payload.parsed?.ticker || symbol.replace(/USDT|USDC|USD|PERP/g, '') || '').toUpperCase();
  const direction = String(payload.direction || payload.parsed?.dir || '').toLowerCase();
  const entryPrice = Number(payload.entry?.price ?? payload.entry ?? payload.parsed?.entry ?? 0) || 0;
  const stopLoss = Number(payload.stopLoss ?? payload.sl ?? payload.parsed?.sl ?? 0) || 0;
  const takeProfits = Array.isArray(payload.takeProfits) ? payload.takeProfits : [];
  const targets = takeProfits.map(tp => Number(tp.price || tp)).filter(Number.isFinite);
  const targetPercents = takeProfits.map(tp => Number(tp.pct || 0)).filter(Number.isFinite);
  const ts = payload.ts || payload.signalTime || payload.date || new Date().toISOString();
  const raw = String(payload.raw || [
    `${source.toUpperCase()} ${payload.strategyId || payload.sourceName || ''}`.trim(),
    `${direction.toUpperCase()} ${symbol}`,
    entryPrice ? `ENTRY ${entryPrice}` : '',
    stopLoss ? `SL ${stopLoss}` : '',
    targets.length ? `TP ${targets.join(' / ')}` : '',
    Array.isArray(payload.explain) && payload.explain.length ? `EXPLAIN ${payload.explain.join('; ')}` : '',
  ].filter(Boolean).join('\n')).trim();
  return {
    id: signalId,
    telegramId: signalId,
    raw,
    source,
    sourceName: payload.strategyId || payload.sourceName || source,
    strategyId: payload.strategyId || '',
    receivedAt: new Date().toISOString(),
    date: ts,
    signalTime: ts,
    originalMessageDate: ts,
    originalDateMissing: false,
    providerSignalId: signalId,
    messageKind: source === 'colony' ? 'colony-paper' : 'inbox',
    parsed: {
      ...(payload.parsed || {}),
      ticker,
      dir: direction,
      exchange: payload.parsed?.exchange || 'BYBIT',
      entry: entryPrice,
      sl: stopLoss,
      targets,
      targetPercents,
      riskPct: Number(payload.riskPct || payload.parsed?.riskPct || 0) || 0,
    },
    colony: source === 'colony' ? {
      signalId,
      strategyId: payload.strategyId || '',
      validUntil: payload.validUntil || '',
      explain: Array.isArray(payload.explain) ? payload.explain : [],
      configHash: payload.configHash || '',
    } : undefined,
    status: payload.status || 'ready',
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function enrichTelegramImageFromBot(env, signal) {
  if (!signal || signal.imageBase64 || !signal.imageFileId) return signal;
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return signal;
  const maxBytes = Number(env.TELEGRAM_IMAGE_MAX_BYTES || 700000);
  try {
    const meta = await safeFetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(signal.imageFileId)}`, {
      timeoutMs: 15000,
    });
    const filePath = meta.data?.result?.file_path || '';
    const fileSize = Number(meta.data?.result?.file_size || 0);
    if (!meta.ok || !filePath) {
      signal.imageError = `Telegram getFile: ${meta.data?.description || meta.raw || meta.status}`;
      return signal;
    }
    if (fileSize && fileSize > maxBytes) {
      signal.imageSkipped = true;
      signal.imageBytes = fileSize;
      return signal;
    }
    const r = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      signal.imageError = `Telegram file HTTP ${r.status}`;
      return signal;
    }
    const mime = r.headers.get('content-type') || '';
    const buffer = await r.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      signal.imageSkipped = true;
      signal.imageBytes = buffer.byteLength;
      signal.imageMimeType = mime;
      return signal;
    }
    if (!/^image\//i.test(mime)) {
      signal.imageError = `Telegram file MIME ${mime || 'desconocido'}`;
      signal.imageMimeType = mime;
      return signal;
    }
    signal.imageBase64 = arrayBufferToBase64(buffer);
    signal.imageMimeType = mime;
    signal.imageBytes = buffer.byteLength;
    signal.hasImage = true;
  } catch(e) {
    signal.imageError = `Telegram image: ${e.message}`;
  }
  return signal;
}

function signalAiBackendUrl(env) {
  return (env.SIGNAL_AI_BACKEND_URL || env.BINANCE_BACKEND_URL || '').trim().replace(/\/+$/, '');
}

function fallbackSignalAi(raw = '', sourceName = '') {
  const text = String(raw || '');
  const ticker = (text.match(/(?:COIN|SYMBOL|PAIR)\s*[:=]?\s*[$#]?([A-Z0-9]{2,15})/i)
    || text.match(/[$#]([A-Z0-9]{2,15})\s*(?:\/|-)?\s*(?:USDT|USDC|USD|PERP)?/i)
    || [])[1] || '';
  const dirMatch = text.match(/\b(LONG|SHORT)\b/i);
  const numsFrom = (label) => {
    const re = new RegExp(`(?:${label})\\s*[:=]?\\s*([^\\n]+)`, 'i');
    const line = text.match(re)?.[1] || '';
    return (line.match(/(?:\d+\.\d+|\.\d+|\d+)/g) || [])
      .map(x => Number(x.startsWith('.') ? '0' + x : x))
      .filter(Number.isFinite);
  };
  const entry = numsFrom('ENTRY|ENTRADA|CMP|CURRENT MARKET');
  const sl = numsFrom('STOP LOSS|STOPLOSS|SL');
  const targets = numsFrom('TARGETS?|TAKE PROFIT|TP');
  return {
    model: 'worker-fallback',
    usedImage: false,
    interpretation: {
      ticker,
      direction: dirMatch ? dirMatch[1].toLowerCase() : '',
      exchange: /kucoin/i.test(text) ? 'KUCOIN' : 'BINANCE',
      leverage: Number((text.match(/(?:\d+\s*-\s*)?(\d{1,3})\s*x/i) || [])[1] || 0) || undefined,
      entryRange: entry.slice(0, 2),
      entry: entry[0] || undefined,
      sl: sl[0] || undefined,
      targets,
      providerSignalId: (text.match(/(?:signal\s*id|signal)\s*[:#]?\s*#?([A-Z]?\d{2,8})/i) || [])[1] || '',
      confidence: 42,
      warnings: ['AI local no disponible; lectura de respaldo del Worker'],
      notes: `Lectura minima sin vision para ${sourceName || 'Telegram'}.`,
    },
  };
}

async function interpretTelegramSignalAi(env, payload = {}) {
  const backendUrl = signalAiBackendUrl(env);
  if (!backendUrl) {
    return { ...fallbackSignalAi(payload.raw, payload.sourceName), warning: 'SIGNAL_AI_BACKEND_URL/BINANCE_BACKEND_URL no configurado' };
  }
  const body = {
    raw: payload.raw || '',
    sourceName: payload.sourceName || '',
    imageBase64: payload.imageBase64 || '',
    imageMimeType: payload.imageMimeType || '',
    imageFileId: payload.photoFileId || payload.imageFileId || '',
  };
  const r = await backendFetch(env, `${backendUrl}/signal-vision-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 55000,
  });
  if (r.ok && r.data) return r.data;
  return {
    ...fallbackSignalAi(payload.raw, payload.sourceName),
    warning: `Oracle AI local no disponible: ${r.data?.error || r.raw || r.status}`,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// BINANCE — via Railway server (IPv4 whitelisted in Binance)
// ═════════════════════════════════════════════════════════════════════════════
async function syncBinance(env) {
  const railwayUrl = (env.RAILWAY_URL || '').trim();
  if (!railwayUrl) return { positions: [], orders: [], error: 'RAILWAY_URL not set' };

  try {
    const r = await backendFetch(env, `${railwayUrl}/binance-positions`);
    if (!r.ok || !r.data) {
      return { positions: [], orders: [], error: `Railway: ${r.status} ${r.raw || ''}` };
    }
    if (r.data.error) {
      return { positions: [], orders: [], error: `Binance via Railway: ${r.data.error}` };
    }

    const r2 = await backendFetch(env, `${railwayUrl}/binance-orders`);
    const orders = r2.ok && r2.data?.orders ? r2.data.orders : [];

    return {
      positions: r.data.positions || [],
      orders,
      error: null,
    };
  } catch(e) {
    return { positions: [], orders: [], error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// BYBIT
// ═════════════════════════════════════════════════════════════════════════════
async function syncBybit(env) {
  const key = env.BYBIT_KEY;
  const sec = env.BYBIT_SECRET;
  if (!key || !sec) return { positions: [], orders: [], error: 'No keys' };

  const positions = [];
  const orders    = [];

  // Trim keys to remove any accidental whitespace
  const k = key.trim();
  const s = sec.trim();

  const bybitHdr = async (q) => {
    const ts  = Date.now().toString();
    const msg = ts + k + '5000' + q;
    return {
      'X-BAPI-API-KEY':     k,
      'X-BAPI-TIMESTAMP':   ts,
      'X-BAPI-SIGN':        await hmac256(s, msg),
      'X-BAPI-RECV-WINDOW': '5000',
    };
  };

  try {
    const q1 = 'category=linear&settleCoin=USDT';
    const r1 = await safeFetch(
      `https://api.bybit.com/v5/position/list?${q1}`,
      { headers: await bybitHdr(q1) }
    );

    if (!r1.ok || !r1.data) {
      return { positions, orders, error: `${r1.status} ${r1.raw || 'no data'}` };
    }
    if (r1.data.retCode !== 0) {
      return { positions, orders, error: `retCode ${r1.data.retCode}: ${r1.data.retMsg}` };
    }

    for (const p of (r1.data.result?.list || []).filter(p => parseFloat(p.size) > 0)) {
      const entry    = parseFloat(p.avgPrice);
      const mark     = parseFloat(p.markPrice);
      const lev      = parseInt(p.leverage) || 1;
      const notional = parseFloat(p.positionValue) || 0;
      const pnl      = parseFloat(p.unrealisedPnl);
      const margin   = notional / lev;
      const liq      = parseFloat(p.liqPrice) || 0;
      const dir      = p.side === 'Buy' ? 'long' : 'short';

      positions.push({
        exchange: 'BYBIT', type: 'futures',
        ticker:      p.symbol.replace('USDT',''),
        symbol:      p.symbol, dir,
        entry, mark,
        pnl:         Math.round(pnl * 100) / 100,
        pnlPct:      margin > 0 ? Math.round(pnl / margin * 10000) / 100 : 0,
        posSize:     Math.round(notional * 100) / 100,
        margin:      Math.round(margin * 100) / 100,
        leverage:    lev, liquidation: liq,
        sl:          parseFloat(p.stopLoss) || null,
        tp1:         parseFloat(p.takeProfit) || null,
        tp2: null, tp3: null,
        exchangeId:  `bybit-pos-${p.symbol}-${dir}`,
        openTime:    parseInt(p.createdTime) || null,
      });
    }

    const q2 = 'category=linear&settleCoin=USDT';
    const r2 = await safeFetch(
      `https://api.bybit.com/v5/order/realtime?${q2}`,
      { headers: await bybitHdr(q2) }
    );
    if (r2.ok && r2.data?.retCode === 0) {
      for (const o of (r2.data.result?.list || [])) {
        orders.push({
          exchange: 'BYBIT', type: o.orderType,
          ticker:     o.symbol.replace('USDT',''),
          symbol:     o.symbol,
          dir:        o.side === 'Buy' ? 'long' : 'short',
          price:      parseFloat(o.price) || parseFloat(o.triggerPrice) || 0,
          origQty:    parseFloat(o.qty),
          size:       parseFloat(o.qty) * (parseFloat(o.price) || 0),
          tp1:        parseFloat(o.takeProfit) || null,
          sl:         parseFloat(o.stopLoss)   || null,
          leverage:   parseInt(o.leverage)     || null,
          exchangeId: `bybit-ord-${o.orderId}`,
        });
      }
    }

    return { positions, orders, error: null };
  } catch(e) {
    return { positions, orders, error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// OKX
// ═════════════════════════════════════════════════════════════════════════════
async function syncOKX(env) {
  const key  = (env.OKX_KEY || '').trim();
  const sec  = (env.OKX_SECRET || '').trim();
  const pass = (env.OKX_PASSPHRASE || '').trim();
  if (!key || !sec || !pass) return { positions: [], orders: [], error: 'No keys' };

  const positions = [];
  const orders    = [];

  const okxHdr = async (path) => {
    const ts  = new Date().toISOString();
    const msg = ts + 'GET' + path;
    const key2 = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(sec),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key2, new TextEncoder().encode(msg));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return {
      'OK-ACCESS-KEY':        key,
      'OK-ACCESS-SIGN':       b64,
      'OK-ACCESS-TIMESTAMP':  ts,
      'OK-ACCESS-PASSPHRASE': pass,
      'Content-Type':         'application/json',
    };
  };

  try {
    const path1 = '/api/v5/account/positions?instType=SWAP';
    const r1    = await safeFetch(
      `https://www.okx.com${path1}`,
      { headers: await okxHdr(path1) }
    );

    if (!r1.ok || !r1.data) {
      return { positions, orders, error: `${r1.status} ${r1.raw || ''}` };
    }
    if (r1.data.code !== '0') {
      return { positions, orders, error: `OKX ${r1.data.code}: ${r1.data.msg}` };
    }

    for (const p of (r1.data.data || []).filter(p => parseFloat(p.pos) !== 0)) {
      const entry    = parseFloat(p.avgPx);
      const mark     = parseFloat(p.markPx);
      const lev      = parseInt(p.lever) || 1;
      const notional = Math.abs(parseFloat(p.notionalUsd)) || 0;
      const pnl      = parseFloat(p.upl);
      const margin   = parseFloat(p.margin) || notional / lev;
      const liq      = parseFloat(p.liqPx) || 0;
      const dir      = parseFloat(p.pos) > 0 ? 'long' : 'short';
      const ticker   = p.instId.replace('-USDT-SWAP','').replace('-','');

      positions.push({
        exchange: 'OKX', type: 'futures',
        ticker, symbol: p.instId, dir,
        entry, mark,
        pnl:         Math.round(pnl * 100) / 100,
        pnlPct:      margin > 0 ? Math.round(pnl / margin * 10000) / 100 : 0,
        posSize:     Math.round(notional * 100) / 100,
        margin:      Math.round(margin * 100) / 100,
        leverage:    lev, liquidation: liq,
        sl: null, tp1: null, tp2: null, tp3: null,
        exchangeId:  `okx-pos-${p.instId}-${dir}`,
      });
    }

    const path2 = '/api/v5/trade/orders-pending?instType=SWAP';
    const r2    = await safeFetch(
      `https://www.okx.com${path2}`,
      { headers: await okxHdr(path2) }
    );
    if (r2.ok && r2.data?.code === '0') {
      for (const o of (r2.data.data || [])) {
        orders.push({
          exchange: 'OKX', type: o.ordType,
          ticker:     o.instId.replace('-USDT-SWAP','').replace('-',''),
          symbol:     o.instId,
          dir:        o.side === 'buy' ? 'long' : 'short',
          price:      parseFloat(o.px) || 0,
          origQty:    parseFloat(o.sz),
          size:       parseFloat(o.sz) * (parseFloat(o.px) || 0),
          tp1:        parseFloat(o.tpTriggerPx) || null,
          sl:         parseFloat(o.slTriggerPx) || null,
          leverage:   parseInt(o.lever) || null,
          exchangeId: `okx-ord-${o.ordId}`,
        });
      }
    }

    return { positions, orders, error: null };
  } catch(e) {
    return { positions, orders, error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MEXC
// ═════════════════════════════════════════════════════════════════════════════
async function syncMEXC(env) {
  const key = (env.MEXC_KEY || '').trim();
  const sec = (env.MEXC_SECRET || '').trim();
  if (!key || !sec) return { positions: [], orders: [], error: 'No keys' };

  const positions = [];
  const orders    = [];

  try {
    const ts = Date.now().toString();
    // MEXC contract API signature: HMAC_SHA256(secret, accessKey + timestamp)
    const sig = await hmac256(sec, key + ts);

    const r1 = await safeFetch(
      'https://contract.mexc.com/api/v1/private/position/open_positions',
      { headers: { 'ApiKey': key, 'Request-Time': ts, 'Signature': sig, 'Content-Type': 'application/json' } }
    );

    if (!r1.ok || !r1.data) {
      return { positions, orders, error: `${r1.status} ${r1.raw || ''}` };
    }
    if (!r1.data.success) {
      return { positions, orders, error: `MEXC ${r1.data.code}: ${r1.data.message}` };
    }

    for (const p of (r1.data.data || [])) {
      const entry    = parseFloat(p.openAvgPrice) || 0;
      const mark     = parseFloat(p.markPrice) || entry;
      const lev      = parseInt(p.leverage) || 1;
      const notional = parseFloat(p.positionValue) || 0;
      const pnl      = parseFloat(p.unrealisedPnl) || 0;
      const margin   = notional / lev;
      const liq      = parseFloat(p.liquidatePrice) || 0;
      const dir      = p.positionType === 1 ? 'long' : 'short';
      const ticker   = p.symbol.replace('_USDT','').replace('USDT','');

      positions.push({
        exchange: 'MEXC', type: 'futures',
        ticker, symbol: p.symbol, dir,
        entry, mark,
        pnl:         Math.round(pnl * 100) / 100,
        pnlPct:      margin > 0 ? Math.round(pnl / margin * 10000) / 100 : 0,
        posSize:     Math.round(notional * 100) / 100,
        margin:      Math.round(margin * 100) / 100,
        leverage:    lev, liquidation: liq,
        sl:          parseFloat(p.stopLossPrice) || null,
        tp1:         parseFloat(p.takeProfitPrice) || null,
        tp2: null, tp3: null,
        exchangeId:  `mexc-pos-${p.symbol}-${dir}`,
      });
    }

    return { positions, orders, error: null };
  } catch(e) {
    return { positions, orders, error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// BALANCES — free USDT/USDC not locked in positions or orders
// ═════════════════════════════════════════════════════════════════════════════
function normalizeBalance(raw = {}) {
  const usdt = Number(raw.USDT ?? raw.usdt ?? 0) || 0;
  const usdc = Number(raw.USDC ?? raw.usdc ?? 0) || 0;
  const fallbackTotal = usdt + usdc;
  const pnl = Number(raw.pnl ?? raw.unrealizedPnl ?? raw.upnl ?? 0) || 0;
  const wallet = Number(raw.wallet ?? raw.totalWalletBalance ?? 0) || 0;
  const rawTotal = Number(raw.total ?? raw.totalEquity ?? raw.equity ?? 0) || 0;
  const total = rawTotal || (wallet ? wallet + pnl : fallbackTotal) || 0;
  const free = Number(raw.free ?? raw.available ?? raw.availableBalance ?? (fallbackTotal || total)) || 0;
  const margin = Number(raw.margin ?? raw.marginUsed ?? 0) || 0;
  const orders = Number(raw.orders ?? raw.orderMargin ?? 0) || 0;

  return {
    total: Math.round(total * 100) / 100,
    free: Math.round(free * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    orders: Math.round(orders * 100) / 100,
    pnl: Math.round(pnl * 100) / 100,
    USDT: Math.round(usdt * 100) / 100,
    USDC: Math.round(usdc * 100) / 100,
  };
}

async function fetchBalances(env) {
  const balances = {};
  const errors   = {};

  // ── Binance via Railway ──────────────────────────────────────────────────
  const railwayUrl = (env.RAILWAY_URL || '').trim();
  if (railwayUrl) {
    try {
      const r = await backendFetch(env, `${railwayUrl}/binance-balance`);
      if (r.ok && r.data && !r.data.error) {
        balances.BINANCE = normalizeBalance(r.data);
      } else {
        errors.BINANCE = r.data?.error || `${r.status}`;
      }
    } catch(e) { errors.BINANCE = e.message; }
  }

  // ── Bybit ────────────────────────────────────────────────────────────────
  const bybitKey = (env.BYBIT_KEY || '').trim();
  const bybitSec = (env.BYBIT_SECRET || '').trim();
  if (bybitKey && bybitSec) {
    try {
      const bybitBalance = async (accountType) => {
        const ts  = Date.now().toString();
        const q   = `accountType=${accountType}`;
        const msg = ts + bybitKey + '5000' + q;
        const sig = await hmac256(bybitSec, msg);
        return safeFetch(
          `https://api.bybit.com/v5/account/wallet-balance?${q}`,
          { headers: { 'X-BAPI-API-KEY': bybitKey, 'X-BAPI-TIMESTAMP': ts,
                       'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': '5000' } }
        );
      };

      // Try UNIFIED first, fall back to CONTRACT
      let r = await bybitBalance('UNIFIED');
      if (!r.ok || r.data?.retCode !== 0) {
        r = await bybitBalance('CONTRACT');
      }

      if (r.ok && r.data?.retCode === 0) {
        let total = 0, free = 0, margin = 0, orders = 0, pnl = 0;
        let totalUsdt = 0, totalUsdc = 0;
        for (const account of (r.data.result?.list || [])) {
          const accountPnl = parseFloat(account.totalPerpUPL || 0);
          const accountEquity = parseFloat(account.totalEquity || 0);
          const accountMarginBalance = parseFloat(account.totalMarginBalance || 0);
          const accountWallet = parseFloat(account.totalWalletBalance || 0);
          const accountTotal = accountEquity || accountMarginBalance || (accountWallet ? accountWallet + accountPnl : 0);
          const accountAvailable = parseFloat(account.totalAvailableBalance || 0);
          const accountInitialMargin = parseFloat(account.totalInitialMargin || 0);
          let accountOrders = 0;
          let accountPositionMargin = 0;
          for (const c of (account.coin || [])) {
            const usdValue = parseFloat(c.usdValue || c.equity || c.walletBalance || 0);
            if (c.coin === 'USDT') totalUsdt += usdValue;
            if (c.coin === 'USDC') totalUsdc += usdValue;
            accountOrders += parseFloat(c.totalOrderIM || 0);
            accountPositionMargin += parseFloat(c.totalPositionIM || 0);
          }
          orders += accountOrders;
          const accountMargin = accountPositionMargin || Math.max(0, accountInitialMargin - accountOrders);
          total += accountTotal;
          margin += accountMargin;
          free += accountAvailable || Math.max(0, accountTotal - accountMargin - accountOrders - accountPnl);
          pnl += accountPnl;
        }
        const fallbackTotal = totalUsdt + totalUsdc + (total ? 0 : pnl);
        balances.BYBIT = normalizeBalance({ total: total || fallbackTotal, free, margin, orders, pnl, USDT: totalUsdt, USDC: totalUsdc });
      } else {
        errors.BYBIT = r.data?.retMsg || `${r.status}`;
      }
    } catch(e) { errors.BYBIT = e.message; }
  }

  // ── OKX ──────────────────────────────────────────────────────────────────
  const okxKey  = (env.OKX_KEY || '').trim();
  const okxSec  = (env.OKX_SECRET || '').trim();
  const okxPass = (env.OKX_PASSPHRASE || '').trim();
  if (okxKey && okxSec && okxPass) {
    try {
      const okxGet = async (path) => {
        const ts   = new Date().toISOString();
        const key2 = await crypto.subtle.importKey('raw', new TextEncoder().encode(okxSec),
          { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig  = await crypto.subtle.sign('HMAC', key2, new TextEncoder().encode(ts + 'GET' + path));
        const b64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
        return safeFetch(`https://www.okx.com${path}`, {
          headers: { 'OK-ACCESS-KEY': okxKey, 'OK-ACCESS-SIGN': b64,
                     'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': okxPass,
                     'Content-Type': 'application/json' }
        });
      };

      const num = (...vals) => {
        for (const v of vals) {
          const n = Number(v);
          if (Number.isFinite(n)) return n;
        }
        return 0;
      };
      let total = 0, free = 0, margin = 0, orders = 0, pnl = 0;
      let usdtTotal = 0, usdcTotal = 0;

      // Trading account (futures/swaps)
      const r1 = await okxGet('/api/v5/account/balance?ccy=USDT,USDC');
      if (r1.ok && r1.data?.code === '0') {
        const account = r1.data.data?.[0] || {};
        total += num(account.totalEq, account.adjEq);
        for (const d of (account.details || [])) {
          const eq = num(d.eq, d.eqUsd, d.disEq, d.cashBal, d.availBal);
          const available = num(d.availEq, d.availBal, d.cashBal);
          free += available;
          margin += num(d.imr);
          orders += num(d.ordFrozen, d.frozenBal);
          pnl += num(d.upl);
          if (d.ccy === 'USDT') usdtTotal += eq;
          if (d.ccy === 'USDC') usdcTotal += eq;
        }
      }

      // Funding account
      const r2 = await okxGet('/api/v5/asset/balances?ccy=USDT,USDC');
      if (r2.ok && r2.data?.code === '0') {
        for (const b of (r2.data.data || [])) {
          const bal = num(b.bal, b.availBal);
          const avail = num(b.availBal, bal);
          total += bal;
          free += avail;
          if (b.ccy === 'USDT') usdtTotal += bal;
          if (b.ccy === 'USDC') usdcTotal += bal;
        }
      }
      let positionPnl = 0, positionMargin = 0;
      const r3 = await okxGet('/api/v5/account/positions');
      if (r3.ok && r3.data?.code === '0') {
        for (const p of (r3.data.data || []).filter(p => num(p.pos) !== 0)) {
          positionPnl += num(p.upl);
          positionMargin += num(p.margin, p.imr, Math.abs(num(p.notionalUsd)) / Math.max(1, num(p.lever) || 1));
        }
      }
      if (positionPnl) pnl = positionPnl;
      if (positionMargin) margin = Math.max(margin, positionMargin);
      if (pnl) total += pnl;

      balances.OKX = normalizeBalance({
        total: total || usdtTotal + usdcTotal,
        free,
        margin,
        orders,
        pnl,
        USDT: usdtTotal,
        USDC: usdcTotal,
      });

      if (!r1.ok && !r2.ok) errors.OKX = r1.data?.msg || `${r1.status}`;
      else if ((total || usdtTotal + usdcTotal || free || margin || orders || pnl) <= 0) errors.OKX = 'OKX respondio sin saldos USDT/USDC utilizables';
    } catch(e) { errors.OKX = e.message; }
  }

  // ── MEXC ─────────────────────────────────────────────────────────────────
  const mexcKey = (env.MEXC_KEY || '').trim();
  const mexcSec = (env.MEXC_SECRET || '').trim();
  if (mexcKey && mexcSec) {
    try {
      let usdtTotal = 0, usdcTotal = 0;

      // Futures account
      const ts1  = Date.now().toString();
      const sig1 = await hmac256(mexcSec, mexcKey + ts1);
      const r1   = await safeFetch(
        'https://contract.mexc.com/api/v1/private/account/assets',
        { headers: { 'ApiKey': mexcKey, 'Request-Time': ts1,
                     'Signature': sig1, 'Content-Type': 'application/json' } }
      );
      if (r1.ok && r1.data?.success) {
        const assets = r1.data.data || [];
        usdtTotal += parseFloat(assets.find(a=>a.currency==='USDT')?.availableBalance || 0);
        usdcTotal += parseFloat(assets.find(a=>a.currency==='USDC')?.availableBalance || 0);
      }

      // Spot account
      const ts2  = Date.now().toString();
      const q2   = `timestamp=${ts2}`;
      const sig2 = await hmac256(mexcSec, q2);
      const r2   = await safeFetch(
        `https://api.mexc.com/api/v3/account?${q2}&signature=${sig2}`,
        { headers: { 'X-MEXC-APIKEY': mexcKey } }
      );
      if (r2.ok && r2.data?.balances) {
        for (const b of r2.data.balances) {
          if (b.asset === 'USDT') usdtTotal += parseFloat(b.free || 0);
          if (b.asset === 'USDC') usdcTotal += parseFloat(b.free || 0);
        }
      }

      balances.MEXC = normalizeBalance({
        total: usdtTotal + usdcTotal,
        free: usdtTotal + usdcTotal,
        margin: 0,
        orders: 0,
        pnl: 0,
        USDT: usdtTotal,
        USDC: usdcTotal,
      });

      if (!r1.ok && !r2.ok) errors.MEXC = r1.data?.message || `${r1.status}`;
    } catch(e) { errors.MEXC = e.message; }
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  let totalUsdt = 0, totalUsdc = 0, totalEquity = 0;
  for (const b of Object.values(balances)) {
    totalUsdt += b.USDT || 0;
    totalUsdc += b.USDC || 0;
    totalEquity += b.total || 0;
  }

  const totals = {
    USDT: Math.round(totalUsdt * 100) / 100,
    USDC: Math.round(totalUsdc * 100) / 100,
    total: Math.round((totalEquity || totalUsdt + totalUsdc) * 100) / 100,
  };

  return {
    balances,  // per-exchange breakdown
    totals,
    liquidity: totals,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN SYNC — called by cron and by /sync endpoint
// ═════════════════════════════════════════════════════════════════════════════
async function syncAll(env) {
  const previousSummary = await readCachedSummary(env);
  let balanceData = { balances: {}, totals: { USDT: 0, USDC: 0, total: 0 }, errors: {} };
  let positions = [];
  let orders = [];
  const syncErrors = {};
  try {
    balanceData = await fetchBalancesV2(env);
  } catch(e) {
    await appendErrorLog(env, { service: 'worker', phase: 'syncAll', message: e.message });
  }
  if (balanceData.errors && Object.keys(balanceData.errors).length) {
    await logBalanceErrors(env, balanceData.errors, 'syncAll');
  }

  const runExchangeSync = async (exchange, fn) => {
    const skipped = await exchangeCooldownActive(env, exchange);
    if (skipped) {
      return [exchange, {
        ...skipped,
        positions: cachedExchangeRows(previousSummary, exchange, 'positions'),
        orders: cachedExchangeRows(previousSummary, exchange, 'orders'),
      }];
    }
    try {
      const data = await fn(env);
      if (data?.error) await setExchangeCooldown(env, exchange, data.error);
      return [exchange, data];
    } catch(error) {
      await setExchangeCooldown(env, exchange, error.message);
      return [exchange, { positions: [], orders: [], error: error.message }];
    }
  };

  const exchangeSyncs = await Promise.all([
    runExchangeSync('BINANCE', syncBinance),
    runExchangeSync('BYBIT', syncBybit),
    runExchangeSync('OKX', syncOKX),
    runExchangeSync('MEXC', syncMEXC),
  ]);

  for (const [exchange, data] of exchangeSyncs) {
    positions.push(...(Array.isArray(data.positions) ? data.positions : []));
    orders.push(...(Array.isArray(data.orders) ? data.orders : []));
    if (data.error && data.error !== 'No keys' && !data.skipped) {
      syncErrors[exchange] = data.error;
      await appendErrorLog(env, { exchange, phase: 'syncAll-orders', message: data.error });
    }
  }

  const totalPnl = Math.round(positions.reduce((sum, p) => sum + (Number(p.pnl) || 0), 0) * 100) / 100;
  const marginInUse = Math.round(positions.reduce((sum, p) => sum + (Number(p.margin) || 0), 0) * 100) / 100;

  const payload = {
    positions,
    orders,
    errors: { ...balanceData.errors, ...syncErrors },
    totalPnl,
    marginInUse,
    lastSync:     new Date().toISOString(),
    cacheSavedAt: null,
    count: { positions: positions.length, orders: orders.length },
    balances:     balanceData.balances,
    liquidity:    balanceData.totals,
    totals:       balanceData.totals,
    balanceErrors: balanceData.errors,
  };

  // Save to KV — only write if data changed (saves KV write quota)
  if (env.MAUEX_CACHE) {
    const prev = await env.MAUEX_CACHE.get('summary');
    let shouldWrite = true;
    if (prev) {
      try {
        const prevData = JSON.parse(prev);
        const lastSaved = Date.parse(prevData.cacheSavedAt || prevData.lastSync || 0);
        shouldWrite = !Number.isFinite(lastSaved) || Date.now() - lastSaved >= 5 * 60 * 1000;
      } catch(e) {}
    }
    if (shouldWrite) {
      payload.cacheSavedAt = new Date().toISOString();
      const newStr = JSON.stringify(payload);
      await env.MAUEX_CACHE.put('summary', newStr, { expirationTtl: 600 });
    }
  }

  return payload;
}

// ═════════════════════════════════════════════════════════════════════════════
// WORKER ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════
export default {

  // ── HTTP requests ─────────────────────────────────────────────────────────
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const json = (data, status = 200) => new Response(
      JSON.stringify(data),
      { status, headers: { 'Content-Type': 'application/json', ...cors } }
    );

    // ── /health ──────────────────────────────────────────────────────────────
    if (url.pathname === '/telegram-webhook') {
      if (!telegramSecretOk(request, url, env)) {
        return json({ ok: false, error: 'Forbidden' }, 403);
      }
      if (!env.MAUEX_CACHE) {
        return json({ ok: false, error: 'MAUEX_CACHE KV no configurado' }, 500);
      }
      let update;
      try {
        update = await request.json();
      } catch(e) {
        return json({ ok: false, error: 'JSON invalido' }, 400);
      }
      const signal = await enrichTelegramImageFromBot(env, normalizeTelegramSignal(update));
      if (!signal) return json({ ok: true, saved: false, reason: 'sin texto' });

      const signals = await loadTelegramSignals(env);
      const ix = signals.findIndex(x => (x.telegramId || x.id) === signal.telegramId);
      if (ix >= 0) {
        signals[ix] = {
          ...signals[ix],
          ...signal,
          receivedAt: signals[ix].receivedAt || signal.receivedAt,
          date: signals[ix].date || signal.date,
          signalTime: signals[ix].signalTime || signal.signalTime,
          originalMessageDate: signals[ix].originalMessageDate || signal.originalMessageDate,
          originalDateMissing: signals[ix].originalDateMissing && signal.originalDateMissing,
        };
      } else {
        signals.unshift(signal);
      }
      try {
        await saveTelegramSignals(env, signals);
      } catch(e) {
        return json({ ok: false, error: 'KV write failed: ' + e.message }, 503);
      }
      return json({ ok: true, saved: ix < 0, updated: ix >= 0, total: signals.length, signal: { id: signal.id, sourceName: signal.sourceName } });
    }

    if (url.pathname === '/signal-inbox') {
      if (!telegramSecretOk(request, url, env)) {
        return json({ ok: false, error: 'Forbidden' }, 403);
      }
      if (!env.MAUEX_CACHE) {
        return json({ ok: false, error: 'MAUEX_CACHE KV no configurado' }, 500);
      }
      let payload;
      try {
        payload = await request.json();
      } catch(e) {
        return json({ ok: false, error: 'JSON invalido' }, 400);
      }
      const signal = normalizeInboxSignal(payload);
      if (!signal) return json({ ok: false, error: 'signal invalida' }, 400);

      const signals = await loadTelegramSignals(env);
      const ix = signals.findIndex(x => (x.telegramId || x.id) === signal.telegramId);
      if (ix >= 0) {
        signals[ix] = {
          ...signals[ix],
          ...signal,
          receivedAt: signals[ix].receivedAt || signal.receivedAt,
        };
      } else {
        signals.unshift(signal);
      }
      try {
        await saveTelegramSignals(env, signals);
      } catch(e) {
        return json({ ok: false, error: 'KV write failed: ' + e.message }, 503);
      }
      return json({ ok: true, saved: ix < 0, updated: ix >= 0, total: signals.length, signal: { id: signal.id, source: signal.source, sourceName: signal.sourceName } });
    }

    if (url.pathname === '/health') {
      const cached = await readCachedSummary(env);
      return json({
        status:    'ok',
        version:   WORKER_VERSION,
        lastSync:  cached?.lastSync || null,
      });
    }

    if (!apiTokenOk(request, env)) {
      return json({ error: 'unauthorized' }, 401);
    }

    if (url.pathname === '/proxy') {
      return handleProxyRequest(request, url, json, cors);
    }

    if (url.pathname === '/errors') {
      if (request.method === 'POST' && url.searchParams.get('clear') === '1') {
        if (env.MAUEX_CACHE) await env.MAUEX_CACHE.delete(ERROR_LOG_KV_KEY);
        await Promise.all(['OKX', 'KUCOIN', 'MEXC'].map(exchange => clearExchangeCooldown(env, exchange)));
        return json({ ok: true, cleared: true, clearedCooldowns: ['OKX', 'KUCOIN', 'MEXC'] });
      }
      const errors = await readErrorLog(env);
      return json({
        ok: true,
        total: errors.length,
        errors24h: countErrorsSince(errors, Date.now() - 24 * 60 * 60 * 1000),
        errors,
        reader: await readReaderHeartbeat(env),
      });
    }

    if (url.pathname === '/reader-heartbeat') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      let payload = {};
      try { payload = await request.json(); } catch(e) {}
      try {
        const heartbeat = await writeReaderHeartbeat(env, payload);
        return json({ ok: true, heartbeat });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === '/ops-health') {
      return json(await buildOpsHealth(env));
    }

    if (url.pathname === '/telegram-signals') {
      if (!telegramSecretOk(request, url, env)) {
        return json({ ok: false, error: 'Forbidden' }, 403);
      }
      const signals = await loadTelegramSignals(env);
      return json({ ok: true, signals, total: signals.length });
    }

    if (url.pathname === '/telegram-signal-ai') {
      if (!telegramSecretOk(request, url, env)) {
        return json({ ok: false, error: 'Forbidden' }, 403);
      }
      let payload = {};
      try {
        payload = await request.json();
      } catch(e) {
        return json({ ok: false, error: 'JSON invalido' }, 400);
      }
      const result = await interpretTelegramSignalAi(env, payload);
      return json(result);
    }

    // ── /balance — free liquidity per exchange ───────────────────────────────
    if (url.pathname === '/diagnose-okx' || url.pathname === '/okx-diagnostic') {
      const diagnostic = await diagnoseOKXBalance(env);
      if (diagnostic?.ok) {
        await clearExchangeCooldown(env, 'OKX');
      }
      return json(diagnostic);
    }

    if (url.pathname === '/diagnose-bybit' || url.pathname === '/bybit-diagnostic') {
      return json(await diagnoseBybitBalance(env));
    }

    if (url.pathname === '/balance') {
      const forceLive = url.searchParams.has('live') || url.searchParams.has('t');
      // Try KV cache first (balance is part of summary)
      let cached = null;
      if (!forceLive && env.MAUEX_CACHE) {
        const raw = await env.MAUEX_CACHE.get('summary');
        if (raw) {
          try {
            const d = JSON.parse(raw);
            if (d.liquidity || d.totals) cached = { balances: d.balances || {}, liquidity: d.liquidity || d.totals, totals: d.totals || d.liquidity, errors: d.balanceErrors || d.errors || {} };
          } catch(e) {}
        }
      }
      if (cached) return json(cached);
      // No cache — fetch live
      const data = await fetchBalancesV2(env);
      if (data.errors && Object.keys(data.errors).length) {
        ctx?.waitUntil?.(logBalanceErrors(env, data.errors, 'balance-live'));
      }
      return json(data);
    }

    // ── /summary, /positions, /orders — read from KV ─────────────────────────
    if (['/summary', '/positions', '/orders'].includes(url.pathname)) {
      const forceLive = url.searchParams.has('live') || url.searchParams.has('t');
      let data = null;
      if (!forceLive && env.MAUEX_CACHE) {
        const raw = await env.MAUEX_CACHE.get('summary');
        if (raw) data = JSON.parse(raw);
      }

      if (!data) {
        // No cache yet — do a live sync
        data = await syncAll(env);
      }

      if (url.pathname === '/positions') return json({ positions: data.positions, lastSync: data.lastSync, errors: data.errors });
      if (url.pathname === '/orders')    return json({ orders: data.orders, lastSync: data.lastSync });
      return json(data);
    }

    // ── /sync — force immediate sync ─────────────────────────────────────────
    if (url.pathname === '/sync') {
      const data = await syncAll(env);
      return json(data);
    }

    // ── /myip ────────────────────────────────────────────────────────────────
    if (url.pathname === '/myip') {
      let ip = null;
      try {
        const r = await fetch('https://api4.ipify.org?format=json');
        const d = await r.json();
        ip = d.ip;
      } catch(e) {
        try {
          const r2 = await fetch('https://ipv4.icanhazip.com');
          ip = (await r2.text()).trim();
        } catch(e2) { ip = 'IPv4 not available'; }
      }
      return json({ ip, note: 'Add this IPv4 to Binance API whitelist' });
    }

    // ── /import-history ──────────────────────────────────────────────────────
    if (url.pathname === '/import-history') {
      const from = url.searchParams.get('from') || '2026-01-01';
      const to   = url.searchParams.get('to')   || new Date().toISOString().split('T')[0];
      const startTs = new Date(from).getTime();
      const endTs   = new Date(to).getTime() + 86400000; // end of day

      const trades  = [];
      const summary = [];

      // Binance via Railway
      const railwayUrl = (env.RAILWAY_URL || '').trim();
      if (railwayUrl) {
        try {
          const r = await backendFetch(env, `${railwayUrl}/binance-history?from=${startTs}&to=${endTs}`);
          if (r.ok && r.data?.trades) {
            trades.push(...r.data.trades);
            summary.push(`✅ BINANCE: ${r.data.trades.length} trades`);
          } else {
            summary.push(`⚠️ BINANCE: ${r.data?.error || 'sin datos'}`);
          }
        } catch(e) {
          summary.push(`❌ BINANCE: ${e.message}`);
        }
      }

      // Bybit history
      const bybitKey = (env.BYBIT_KEY || '').trim();
      const bybitSec = (env.BYBIT_SECRET || '').trim();
      if (bybitKey && bybitSec) {
        try {
          const ts  = Date.now().toString();
          const q   = `category=linear&startTime=${startTs}&endTime=${endTs}&limit=100`;
          const msg = ts + bybitKey + '5000' + q;
          const sig = await hmac256(bybitSec, msg);
          const r   = await safeFetch(
            `https://api.bybit.com/v5/execution/list?${q}`,
            { headers: { 'X-BAPI-API-KEY': bybitKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': '5000' } }
          );
          if (r.ok && r.data?.retCode === 0) {
            const byOrder = {};
            (r.data.result?.list || []).forEach(t => {
              if(!byOrder[t.orderId]) byOrder[t.orderId] = { trades:[], symbol:t.symbol, side:t.side, pnl:0, fee:0, time:parseInt(t.execTime) };
              byOrder[t.orderId].trades.push(t);
              byOrder[t.orderId].pnl += parseFloat(t.closedPnl||0);
              byOrder[t.orderId].fee += parseFloat(t.execFee||0);
            });
            const bybitTrades = Object.values(byOrder).filter(o => o.pnl !== 0).map(o => ({
              exchangeSource: 'BYBIT', exchangeId: `bybit-${o.trades[0].orderId}`,
              ticker: o.symbol.replace('USDT',''), dir: o.side==='Buy'?'long':'short',
              exchange: 'BYBIT', type: 'futures',
              entry: parseFloat(o.trades[0]?.execPrice)||0,
              closePrice: parseFloat(o.trades[o.trades.length-1]?.execPrice)||0,
              pnl: Math.round((o.pnl-o.fee)*100)/100, fees: Math.round(o.fee*100)/100,
              posSize: parseFloat(o.trades[0]?.execValue)||0,
              status: 'closed',
              createdAt: new Date(o.time).toISOString(),
              closeDate: new Date(o.time).toISOString().split('T')[0],
              closeNotes: 'Importado de Bybit',
            }));
            trades.push(...bybitTrades);
            summary.push(`✅ BYBIT: ${bybitTrades.length} trades`);
          } else {
            summary.push(`⚠️ BYBIT: ${r.data?.retMsg || 'sin datos'}`);
          }
        } catch(e) { summary.push(`❌ BYBIT: ${e.message}`); }
      }

      // OKX history
      const okxKey  = (env.OKX_KEY || '').trim();
      const okxSec  = (env.OKX_SECRET || '').trim();
      const okxPass = (env.OKX_PASSPHRASE || '').trim();
      if (okxKey && okxSec && okxPass) {
        try {
          const okxHdr = async (path) => {
            const ts  = new Date().toISOString();
            const key2 = await crypto.subtle.importKey('raw', new TextEncoder().encode(okxSec), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
            const sig  = await crypto.subtle.sign('HMAC', key2, new TextEncoder().encode(ts+'GET'+path));
            const b64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
            return { 'OK-ACCESS-KEY': okxKey, 'OK-ACCESS-SIGN': b64, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': okxPass, 'Content-Type': 'application/json' };
          };
          const path = `/api/v5/trade/fills-history?instType=SWAP&begin=${startTs}&end=${endTs}&limit=100`;
          const r    = await safeFetch(`https://www.okx.com${path}`, { headers: await okxHdr(path) });
          if (r.ok && r.data?.code === '0') {
            const byOrder = {};
            (r.data.data || []).forEach(t => {
              if(!byOrder[t.ordId]) byOrder[t.ordId] = { trades:[], instId:t.instId, side:t.side, pnl:0, fee:0, time:parseInt(t.ts) };
              byOrder[t.ordId].trades.push(t);
              byOrder[t.ordId].pnl += parseFloat(t.pnl||0);
              byOrder[t.ordId].fee += Math.abs(parseFloat(t.fee||0));
            });
            const okxTrades = Object.values(byOrder).filter(o => o.pnl !== 0).map(o => ({
              exchangeSource: 'OKX', exchangeId: `okx-${o.trades[0].tradeId}`,
              ticker: o.instId.replace('-USDT-SWAP','').replace('-',''), dir: o.side==='buy'?'long':'short',
              exchange: 'OKX', type: 'futures',
              entry: parseFloat(o.trades[0]?.fillPx)||0,
              closePrice: parseFloat(o.trades[o.trades.length-1]?.fillPx)||0,
              pnl: Math.round((o.pnl-o.fee)*100)/100, fees: Math.round(o.fee*100)/100,
              posSize: parseFloat(o.trades[0]?.fillNotionalUsd)||0,
              status: 'closed',
              createdAt: new Date(o.time).toISOString(),
              closeDate: new Date(o.time).toISOString().split('T')[0],
              closeNotes: 'Importado de OKX',
            }));
            trades.push(...okxTrades);
            summary.push(`✅ OKX: ${okxTrades.length} trades`);
          } else {
            summary.push(`⚠️ OKX: ${r.data?.msg || 'sin datos'}`);
          }
        } catch(e) { summary.push(`❌ OKX: ${e.message}`); }
      }

      return json({ trades, summary, total: trades.length });
    }

    // ── /position-history — fetch closed positions from exchanges ──────────────
    if (url.pathname === '/position-history') {
      const from = url.searchParams.get('from') || '2026-01-01';
      const to   = url.searchParams.get('to')   || new Date().toISOString().split('T')[0];
      const startTs = new Date(from).getTime();
      const endTs   = new Date(to).getTime() + 86400000;

      const trades  = [];
      const summary = [];

      // Bybit position history — max 7 days per request, so we chunk
      const bybitKey = (env.BYBIT_KEY || '').trim();
      const bybitSec = (env.BYBIT_SECRET || '').trim();
      if (bybitKey && bybitSec) {
        try {
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
          let bybitTotal = 0;
          let chunkStart = startTs;

          while (chunkStart < endTs) {
            const chunkEnd = Math.min(chunkStart + SEVEN_DAYS, endTs);
            const ts  = Date.now().toString();
            const q   = `category=linear&startTime=${chunkStart}&endTime=${chunkEnd}&limit=100`;
            const msg = ts + bybitKey + '5000' + q;
            const sig = await hmac256(bybitSec, msg);
            const r   = await safeFetch(
              `https://api.bybit.com/v5/position/closed-pnl?${q}`,
              { headers: { 'X-BAPI-API-KEY': bybitKey, 'X-BAPI-TIMESTAMP': ts,
                           'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': '5000' } }
            );
            if (r.ok && r.data?.retCode === 0) {
              const list = r.data.result?.list || [];
              bybitTotal += list.length;
              list.forEach(p => {
                const pnl  = parseFloat(p.closedPnl);
                const fees = Math.abs(parseFloat(p.cumExecFee || 0));
                trades.push({
                  exchangeSource: 'BYBIT',
                  exchangeId:     `bybit-pos-${p.symbol}-${p.orderId}`,
                  ticker:         p.symbol.replace('USDT',''),
                  dir:            p.side === 'Buy' ? 'long' : 'short',
                  exchange:       'BYBIT',
                  type:           'futures',
                  entry:          parseFloat(p.avgEntryPrice) || 0,
                  closePrice:     parseFloat(p.avgExitPrice)  || 0,
                  pnl:            Math.round((pnl - fees) * 100) / 100,
                  pnlRaw:         Math.round(pnl * 100) / 100,
                  fees:           Math.round(fees * 100) / 100,
                  posSize:        parseFloat(p.cumEntryValue) || 0,
                  leverage:       parseInt(p.leverage) || 1,
                  status:         'closed',
                  createdAt:      new Date(parseInt(p.createdTime)).toISOString(),
                  closeDate:      new Date(parseInt(p.updatedTime)).toISOString().split('T')[0],
                  closeNotes:     'Importado de Bybit (position history)',
                });
              });
            }
            chunkStart = chunkEnd + 1;
          }
          summary.push(`✅ BYBIT: ${bybitTotal} posiciones`);
        } catch(e) { summary.push(`❌ BYBIT: ${e.message}`); }
      }

      // OKX position history
      const okxKey  = (env.OKX_KEY || '').trim();
      const okxSec  = (env.OKX_SECRET || '').trim();
      const okxPass = (env.OKX_PASSPHRASE || '').trim();
      if (okxKey && okxSec && okxPass) {
        try {
          const okxHdr = async (path) => {
            const ts   = new Date().toISOString();
            const key2 = await crypto.subtle.importKey('raw', new TextEncoder().encode(okxSec),
              { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
            const sig  = await crypto.subtle.sign('HMAC', key2, new TextEncoder().encode(ts+'GET'+path));
            const b64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
            return { 'OK-ACCESS-KEY': okxKey, 'OK-ACCESS-SIGN': b64,
                     'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': okxPass,
                     'Content-Type': 'application/json' };
          };
          // OKX closed positions
          const path = `/api/v5/account/positions-history?instType=SWAP&mgnMode=isolated&limit=100`;
          const r    = await safeFetch(`https://www.okx.com${path}`, { headers: await okxHdr(path) });
          if (r.ok && r.data?.code === '0') {
            const list = r.data.data || [];
            // Filter by date range
            const filtered = list.filter(p => {
              const t = parseInt(p.uTime);
              return t >= startTs && t <= endTs;
            });
            filtered.forEach(p => {
              const pnl  = parseFloat(p.realizedPnl);
              const fees = parseFloat(p.fee) || 0;
              const ticker = p.instId.replace('-USDT-SWAP','').replace('-','');
              trades.push({
                exchangeSource: 'OKX',
                exchangeId:     `okx-pos-${p.instId}-${p.uTime}`,
                ticker,
                dir:            parseFloat(p.pos) > 0 ? 'long' : 'short',
                exchange:       'OKX',
                type:           'futures',
                entry:          parseFloat(p.openAvgPx) || 0,
                closePrice:     parseFloat(p.closeAvgPx) || 0,
                pnl:            Math.round(pnl * 100) / 100,
                fees:           Math.round(Math.abs(fees) * 100) / 100,
                posSize:        parseFloat(p.notionalUsd) || 0,
                leverage:       parseInt(p.lever) || 1,
                status:         'closed',
                createdAt:      new Date(parseInt(p.cTime)).toISOString(),
                closeDate:      new Date(parseInt(p.uTime)).toISOString().split('T')[0],
                closeNotes:     'Importado de OKX (position history)',
              });
            });
            summary.push(`✅ OKX: ${filtered.length} posiciones`);
          } else {
            summary.push(`⚠️ OKX: ${r.data?.msg || 'sin datos'}`);
          }
        } catch(e) { summary.push(`❌ OKX: ${e.message}`); }
      }

      // Binance via Railway
      const railwayUrl = (env.RAILWAY_URL || '').trim();
      if (railwayUrl) {
        try {
          const r = await backendFetch(env, `${railwayUrl}/binance-position-history?from=${startTs}&to=${endTs}`);
          if (r.ok && r.data?.trades) {
            trades.push(...r.data.trades);
            summary.push(`✅ BINANCE: ${r.data.trades.length} posiciones`);
          } else {
            summary.push(`⚠️ BINANCE: ${r.data?.error || 'sin datos'}`);
          }
        } catch(e) { summary.push(`❌ BINANCE: ${e.message}`); }
      }

      return json({ trades, summary, total: trades.length });
    }

    // ── Legacy proxy (for AI analysis charts, Yahoo Finance) ─────────────────
    const targetUrl = url.searchParams.get('url');
    if (targetUrl) {
      const allowed = [
        'api.binance.com', 'fapi.binance.com',
        'api.kucoin.com', 'api-futures.kucoin.com',
        'query1.finance.yahoo.com', 'query2.finance.yahoo.com',
        'api.alternative.me',
        'contract.mexc.com', 'api.mexc.com',
        'api.kraken.com', 'api.coingecko.com',
      ];
      let targetDomain;
      try { targetDomain = new URL(targetUrl).hostname; } catch(e) {
        return json({ error: 'Invalid URL' }, 400);
      }
      if (!allowed.includes(targetDomain)) {
        return json({ error: 'Domain not allowed: ' + targetDomain }, 403);
      }
      const headers = {};
      for (const [k, v] of request.headers.entries()) {
        if (['host','connection','cf-connecting-ip','cf-ray','cf-visitor','cf-ipcountry'].includes(k.toLowerCase())) continue;
        headers[k] = v;
      }
      const r = await fetch(targetUrl, { method: request.method, headers });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', ...cors }
      });
    }

    return json({ error: 'Not found', endpoints: ['/health','/ops-health','/errors','/reader-heartbeat','/proxy','/summary','/positions','/orders','/sync','/myip','/diagnose-okx','/okx-diagnostic','/diagnose-bybit','/bybit-diagnostic','/telegram-webhook','/signal-inbox','/telegram-signals','/telegram-signal-ai'] }, 404);
  },

  // ── Cron trigger — runs every minute ─────────────────────────────────────
  async scheduled(event, env, ctx) {
    try {
      console.log('Cron sync starting...');
      const data = await syncAll(env);
      console.log(`Cron done: ${data.count.positions} positions, ${data.count.orders} orders`);
      for (const [exchange, message] of Object.entries(data.errors || {})) {
        console.error(`${exchange}:`, message);
      }
    } catch(e) {
      console.error('Cron sync failed:', e?.message || e);
      ctx?.waitUntil?.(appendErrorLog(env, { service: 'worker', phase: 'cron', message: e?.message || e }));
    }
  },
};
