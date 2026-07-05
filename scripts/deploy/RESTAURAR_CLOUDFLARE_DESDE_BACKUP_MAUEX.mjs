import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const wranglerLogPath = path.join(root, '.wrangler', 'logs');
fs.mkdirSync(wranglerLogPath, { recursive: true });
const backupPath = path.join(root, 'BACKUP_VARIABLES_CLOUDFLARE_MAUEX.txt');
const accountPath = path.join(root, '.wrangler', 'cache', 'wrangler-account.json');
const workerName = 'mauex-proxy';
const compatDate = '2026-06-24';
const fallbackAccountId = 'a4a273b7ed1040a90daf7a4b523e23f3';
const wranglerPrefix = ['npx.cmd', '--cache', '.\\.npm-cache', 'wrangler'];

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function quoteCmdArg(arg) {
  const text = String(arg);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function run(args, opts = {}) {
  const cmd = [...wranglerPrefix, ...args].map(quoteCmdArg).join(' ');
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
    cwd: root,
    encoding: 'utf8',
    stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_WRITE_LOGS: 'false',
      WRANGLER_LOG_PATH: wranglerLogPath,
    },
  });
  if (result.error || result.status !== 0) {
    const err = new Error(result.error?.message || `Wrangler salio con codigo ${result.status}`);
    err.stdout = result.stdout;
    err.stderr = result.stderr;
    err.status = result.status;
    throw err;
  }
  return result.stdout || '';
}

function safeCommandError(e) {
  const pieces = [];
  const stdout = e?.stdout ? String(e.stdout).trim() : '';
  const stderr = e?.stderr ? String(e.stderr).trim() : '';
  const message = e?.message ? String(e.message).trim() : '';
  if (stdout) pieces.push(stdout);
  if (stderr) pieces.push(stderr);
  if (!pieces.length && message) pieces.push(message);
  return pieces.join('\n').replace(/([A-Z0-9_]*TOKEN[A-Z0-9_]*=)[^\s]+/gi, '$1[oculto]');
}

function parseBackup(text) {
  const out = {};
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^[-*]?\s*([A-Z0-9_]{3,})\s*[:=]\s*(.+?)\s*$/);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value && !/^(true|false|null|\[REDACTED\])$/i.test(value)) out[key] = value;
  }
  return out;
}

if (!fs.existsSync(backupPath)) fail('No encontre BACKUP_VARIABLES_CLOUDFLARE_MAUEX.txt');
let accountId = fallbackAccountId;
if (fs.existsSync(accountPath)) {
  const account = JSON.parse(fs.readFileSync(accountPath, 'utf8')).account || {};
  accountId = account.id || accountId;
}
if (!accountId) fail('No pude determinar el account id de Cloudflare.');
log(`Cloudflare account id detectado: ${accountId.slice(0, 6)}...`);

const backup = parseBackup(fs.readFileSync(backupPath, 'utf8'));
const allNames = Object.keys(backup).sort();
log(`Backup leido. Variables encontradas: ${allNames.length ? allNames.join(', ') : 'ninguna'}`);

const restoreNames = [
  'BINANCE_BACKEND_URL',
  'RAILWAY_URL',
  'KUCOIN_BACKEND_URL',
  'IBKR_BACKEND_URL',
  'SIGNAL_AI_BACKEND_URL',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'BYBIT_KEY',
  'BYBIT_SECRET',
  'OKX_KEY',
  'OKX_SECRET',
  'OKX_PASSPHRASE',
  'MEXC_KEY',
  'MEXC_SECRET',
].filter(name => backup[name]);

if (!restoreNames.length) fail('El backup no tiene variables parseables para restaurar.');

try {
  const who = run(['whoami']);
  log('Wrangler autenticado.');
} catch (e) {
  const detail = safeCommandError(e);
  if (detail) {
    console.error('Wrangler rechazo la autenticacion. Detalle seguro:');
    console.error(detail);
  }
  fail('Wrangler no esta logueado para este restaurador. Ejecuta LOGIN_CLOUDFLARE_WRANGLER_MAUEX.bat y confirma que al final diga "You are logged in".');
}

if (process.argv.includes('--check-auth')) {
  process.exit(0);
}

let namespaces = [];
try {
  const raw = run(['kv', 'namespace', 'list']);
  namespaces = JSON.parse(raw);
} catch (e) {
  fail('No pude listar KV namespaces con Wrangler.');
}

const wantedKv = (backup.MAUEX_CACHE || '').trim();
let kv = namespaces.find(x => x.title === wantedKv)
  || namespaces.find(x => /mauex/i.test(x.title || ''))
  || namespaces.find(x => /cache/i.test(x.title || ''));

if (!kv) {
  log('No encontre KV existente para MAUEX. Creo namespace MAUEX_CACHE...');
  const created = run(['kv', 'namespace', 'create', 'MAUEX_CACHE']);
  const idMatch = created.match(/id\s*=\s*"([^"]+)"/i) || created.match(/"id"\s*:\s*"([^"]+)"/i);
  if (!idMatch) fail('Cree/intente crear KV pero no pude leer el namespace id.');
  kv = { id: idMatch[1], title: 'MAUEX_CACHE' };
}

log(`KV seleccionado para MAUEX_CACHE: ${kv.title || 'sin titulo'} (${String(kv.id).slice(0, 6)}...)`);

const configPath = path.join(root, 'wrangler.mauex.restore.jsonc');
const config = {
  name: workerName,
  main: 'worker.js',
  compatibility_date: compatDate,
  account_id: accountId,
  kv_namespaces: [
    { binding: 'MAUEX_CACHE', id: kv.id },
  ],
  triggers: {
    crons: ['* * * * *'],
  },
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

log('Desplegando worker.js con binding MAUEX_CACHE...');
run(['deploy', '--config', configPath, '--keep-vars'], { stdio: 'inherit' });

const secretPath = path.join(root, '.mauex_restore_secrets.tmp.json');
const secrets = {};
for (const name of restoreNames) secrets[name] = backup[name];
fs.writeFileSync(secretPath, JSON.stringify(secrets, null, 2), 'utf8');

try {
  log(`Restaurando ${restoreNames.length} variables/secrets desde backup...`);
  run(['secret', 'bulk', secretPath, '--name', workerName], { stdio: 'inherit' });
} finally {
  try { fs.unlinkSync(secretPath); } catch {}
}

log('Restauracion aplicada. Verificando /health...');
const health = await fetch('https://mauex-proxy.mauaparo.workers.dev/health').then(r => r.json());
log(`version=${health.version || 'sin version'}`);
log(`hasKV=${!!health.hasKV}`);
log(`keys=${JSON.stringify(health.keys || {})}`);

const missing = [];
const keys = health.keys || {};
if (!health.hasKV) missing.push('MAUEX_CACHE');
if (!keys.binanceBackend && !keys.railway) missing.push('BINANCE_BACKEND_URL o RAILWAY_URL');
if (!keys.kucoinBackend) missing.push('KUCOIN_BACKEND_URL');
if (!keys.ibkrBackend) missing.push('IBKR_BACKEND_URL');

if (missing.length) {
  fail('Restauracion incompleta. Faltan: ' + missing.join(', '));
}

const notInBackup = [];
if (!keys.bybit) notInBackup.push('BYBIT_KEY / BYBIT_SECRET');
if (!keys.okx) notInBackup.push('OKX_KEY / OKX_SECRET / OKX_PASSPHRASE');
if (!keys.mexc) notInBackup.push('MEXC_KEY / MEXC_SECRET');
if (!keys.telegram) notInBackup.push('TELEGRAM_WEBHOOK_SECRET');
if (!keys.telegramBot) notInBackup.push('TELEGRAM_BOT_TOKEN');

log('OK: Worker restaurado con KV y variables de backend del backup.');
if (notInBackup.length) {
  log('ATENCION: Estos secrets no estaban con valor en el backup local y Cloudflare no permite leerlos de vuelta:');
  for (const name of notInBackup) log('  - ' + name);
  log('Para recuperarlos sin reescribirlos manualmente, usa rollback/version anterior en Cloudflare si existe.');
}
