const fs = require('fs');
const path = require('path');
const input = require('input');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const DATA_DIR = process.env.MAUEX_TELEGRAM_DIR || '/opt/mauex-telegram';
const SESSION_FILE = path.join(DATA_DIR, 'telegram.session');
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');

const apiId = Number(process.env.TELEGRAM_API_ID || 0);
const apiHash = process.env.TELEGRAM_API_HASH || '';
const workerUrl = (process.env.MAUEX_WORKER_URL || 'https://mauex-proxy.mauaparo.workers.dev').replace(/\/+$/, '');
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_INBOX_SECRET || '';
const channelNeedles = (process.env.MAUEX_TELEGRAM_CHANNELS || 'binance killers,bitcoin bullets')
  .split(',')
  .map(s => normalize(s))
  .filter(Boolean);
const backfillLimit = Math.max(0, Number(process.env.MAUEX_TELEGRAM_BACKFILL || 20));

function normalize(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSession() {
  try { return fs.readFileSync(SESSION_FILE, 'utf8').trim(); } catch (_) { return ''; }
}

function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, session || '', { mode: 0o600 });
}

function loadSeen() {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    return new Set(Array.isArray(data) ? data : []);
  } catch (_) {
    return new Set();
  }
}

function saveSeen(seen) {
  const arr = Array.from(seen).slice(-1000);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(arr, null, 2));
}

function sourceName(entity) {
  return entity?.title || entity?.username || entity?.firstName || entity?.id?.toString?.() || 'Telegram';
}

function sourceMatches(entity) {
  const source = normalize(`${entity?.title || ''} ${entity?.username || ''}`);
  return channelNeedles.some(needle => source.includes(needle));
}

function providerSignalId(text) {
  const m = String(text || '').match(/(?:signal\s*id|signal)\s*[:#]?\s*#?([A-Z]?\d{2,8})/i);
  return m ? m[1].toUpperCase() : '';
}

function looksLikeNewSignal(text) {
  const raw = String(text || '');
  const t = normalize(raw);
  if (!t) return false;
  if (/\b(update|target\s*\d+|tp\s*\d+|profit|closing|closed|breakeven|break even)\b/i.test(raw) && !/\b(entry|stop\s*loss|targets?)\b/i.test(raw)) return false;
  const hasTicker = /(?:coin|symbol)\s*[:=]?\s*[$#]?[A-Z0-9]{2,12}/i.test(raw) || /[$#][A-Z0-9]{2,12}\s*(?:\/|-)?\s*USDT/i.test(raw);
  const hasDirection = /\b(long|short)\b/i.test(raw);
  const hasEntry = /\b(entry|entries|buy\s+limit|sell\s+limit)\b/i.test(raw);
  const hasStop = /\b(stop\s*loss|stoploss|\bsl\b)\b/i.test(raw);
  const hasTarget = /\b(targets?|take\s*profit|\btp\d*)\b/i.test(raw);
  return hasTicker && (hasDirection || hasEntry) && (hasEntry || hasTarget) && (hasStop || hasTarget);
}

async function postToMauex(entity, msg) {
  const raw = msg.message || '';
  if (!looksLikeNewSignal(raw)) return false;

  const chatId = entity?.id?.toString?.() || 'telegram';
  const id = `${chatId}:${msg.id}`;
  if (seen.has(id)) return false;

  const payload = {
    update_id: Number(String(msg.id).slice(-9)) || Date.now(),
    channel_post: {
      message_id: msg.id,
      date: msg.date || Math.floor(Date.now() / 1000),
      chat: {
        id: Number(String(entity?.id || '').replace(/\D/g, '').slice(-12)) || 0,
        title: sourceName(entity),
        username: entity?.username || '',
        type: 'channel'
      },
      text: raw,
      caption: raw,
      entities: [],
      mauex_source: 'telegram-user-reader',
      mauex_provider_signal_id: providerSignalId(raw)
    }
  };

  const res = await fetch(`${workerUrl}/telegram-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': webhookSecret
    },
    body: JSON.stringify(payload)
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[MAUex] Worker rechazo ${sourceName(entity)} #${msg.id}: ${res.status} ${body.slice(0, 300)}`);
    return false;
  }

  seen.add(id);
  saveSeen(seen);
  console.log(`[MAUex] Senal enviada: ${sourceName(entity)} #${msg.id}${providerSignalId(raw) ? ' ID ' + providerSignalId(raw) : ''}`);
  return true;
}

async function main() {
  ensureDir();
  if (!apiId || !apiHash || !webhookSecret) {
    throw new Error('Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_WEBHOOK_SECRET.');
  }

  const client = new TelegramClient(new StringSession(loadSession()), apiId, apiHash, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => input.text('Telefono Telegram con codigo pais (ej: +549...): '),
    password: async () => input.password('Password 2FA de Telegram, si tenes: '),
    phoneCode: async () => input.text('Codigo que llego a Telegram: '),
    onError: err => console.error(err)
  });
  saveSession(client.session.save());

  const dialogs = await client.getDialogs({});
  const channels = dialogs
    .map(d => d.entity)
    .filter(Boolean)
    .filter(sourceMatches);

  console.log(`[MAUex] Canales monitoreados: ${channels.map(sourceName).join(', ') || 'ninguno'}`);
  if (!channels.length) {
    console.log('[MAUex] No encontre los canales. Revisa que tu cuenta de Telegram sea miembro y que los nombres contengan Binance Killers o Bitcoin Bullets.');
  }

  for (const entity of channels) {
    if (!backfillLimit) continue;
    const messages = await client.getMessages(entity, { limit: backfillLimit });
    for (const msg of messages.reverse()) {
      try { await postToMauex(entity, msg); } catch (e) { console.error(`[MAUex] Backfill error: ${e.message}`); }
    }
  }

  if (process.env.MAUEX_TELEGRAM_LOGIN_ONLY === '1') {
    console.log('[MAUex] Login probado y sesion guardada. El servicio permanente se inicia ahora.');
    await client.disconnect();
    return;
  }

  client.addEventHandler(async event => {
    const msg = event.message;
    if (!msg?.message) return;
    const entity = await msg.getChat();
    if (!sourceMatches(entity)) return;
    try { await postToMauex(entity, msg); } catch (e) { console.error(`[MAUex] Error enviando senal: ${e.message}`); }
  }, new NewMessage({}));

  console.log('[MAUex] Lector Telegram activo. Puede quedar corriendo con la PC apagada.');
}

const seen = loadSeen();

main().catch(err => {
  console.error('[MAUex] Error fatal:', err.message);
  process.exit(1);
});
