'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 25 * 1024 * 1024);
const HISTORY_RETENTION_HOURS = Number(process.env.HISTORY_RETENTION_HOURS || 24);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || process.env.MAX_HISTORY_ITEMS || 20000);
const MAX_DB_HISTORY = Number(process.env.MAX_DB_HISTORY || 5000);
const MAX_COMMANDS = Number(process.env.MAX_COMMANDS || 300);
const MAX_LOGS = Number(process.env.MAX_LOGS || 300);

// Dashboard externo: memória apenas. Não lê nem escreve ficheiros de persistência.
// Se o Render reiniciar/redeployar, latest/histórico/comandos desaparecem, mas a recepção em tempo real continua sem I/O local.
const REQUIRE_TELEMETRY_KEY = String(process.env.REQUIRE_TELEMETRY_KEY || 'false').toLowerCase() === 'true';
const TELEMETRY_KEY = process.env.TELEMETRY_KEY || process.env.DASHBOARD_SHARED_SECRET || process.env.API_KEY || '';
const LIVE_CONTROL_PASSWORD = process.env.LIVE_CONTROL_PASSWORD || 'Zeus';
const REQUIRE_COMMAND_SECRET = String(process.env.REQUIRE_COMMAND_SECRET || 'false').toLowerCase() === 'true';

const store = {
  latest: null,
  latestReceivedAt: null,
  latestRawBody: null,
  history: [], // { receivedAt, item }
  dbHistory: [], // { receivedAt, item }
  commands: [],
  logs: []
};
const eventClients = new Set();

function normalizePathname(value) {
  const clean = String(value || '/').replace(/\/+/g, '/');
  if (clean === '/') return '/';
  return clean.replace(/\/$/, '') || '/';
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Telemetry-Key,X-Dashboard-Secret,X-Control-Password,X-Live-Control-Password,X-RPA-Source,X-RPA-Instance',
    'Access-Control-Expose-Headers': 'X-Latest-Received-At',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { ok: false, error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Payload demasiado grande. Limite actual: ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeParseJson(text) {
  try { return JSON.parse(text || '{}'); }
  catch { return { rawBody: String(text || ''), parseWarning: 'JSON inválido recebido; mantido como texto bruto.' }; }
}

function text(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function normalizeRuntime(value) {
  const raw = String(value || 'web').toLowerCase();
  if (raw.includes('api')) return 'api';
  return 'web';
}

function isAuthorized(req) {
  if (!TELEMETRY_KEY) return !REQUIRE_TELEMETRY_KEY;
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return [req.headers['x-telemetry-key'], req.headers['x-dashboard-secret'], auth].some(v => String(v || '') === TELEMETRY_KEY);
}

function isControlAuthorized(req, payload = {}) {
  return [
    payload.controlPassword,
    payload.password,
    payload.liveControlPassword,
    req.headers['x-control-password'],
    req.headers['x-live-control-password']
  ].some(v => String(v || '') === LIVE_CONTROL_PASSWORD);
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of [...eventClients]) {
    try { res.write(data); } catch { eventClients.delete(res); }
  }
}

function addLog(level, message, extra = {}) {
  const item = { type: 'log', timestamp: new Date().toISOString(), level, message, ...extra };
  store.logs.push(item);
  store.logs = store.logs.slice(-MAX_LOGS);
  broadcast(item);
}

async function handleJson(req, res, handler) {
  let raw;
  try { raw = await readBody(req); }
  catch (error) { return sendJson(res, 413, { ok: false, error: error.message }); }
  const parsed = safeParseJson(raw);
  return handler(parsed, raw);
}

function itemTimestamp(item, fallback = null) {
  const value = pick(
    item,
    'dataHoraOrigem', 'heartbeat', 'receivedAt', 'ultimaAtualizacao',
    'Data_Hora_Inicio', 'Data_Hora_Fim', 'Criado_Em', 'DataHoraInicio', 'DataHoraFim'
  );
  const date = value ? new Date(value) : null;
  if (date && !Number.isNaN(date.getTime())) return date.toISOString();
  return fallback || new Date().toISOString();
}

function pruneHistory() {
  const cutoff = Date.now() - HISTORY_RETENTION_HOURS * 60 * 60 * 1000;
  const keepRecent = record => {
    const date = new Date(record.receivedAt || itemTimestamp(record.item));
    return !Number.isNaN(date.getTime()) && date.getTime() >= cutoff;
  };

  store.history = store.history.filter(keepRecent).slice(-MAX_HISTORY);
  store.dbHistory = store.dbHistory.filter(keepRecent).slice(-MAX_DB_HISTORY);
}

function getExecutionId(item) {
  const value = pick(item, 'idExecucao', 'Id_Execucao', 'id_execucao', 'IdExecucao');
  return value === undefined || value === null || value === '' ? null : String(value);
}

function mergedHistoryItems(limit = MAX_HISTORY) {
  pruneHistory();
  const all = store.history.map(x => ({ ...x, source: 'telemetry' }))
    .concat(store.dbHistory.map(x => ({ ...x, source: 'sql' })));

  // Dedupe só para linhas SQL da mesma execução quando chegam vários syncs; telemetria em tempo real mantém pontos de evolução.
  const seenDb = new Set();
  const result = [];
  for (const record of all.slice().reverse()) {
    const item = record.item;
    const id = getExecutionId(item);
    if (record.source === 'sql' && id) {
      if (seenDb.has(id)) continue;
      seenDb.add(id);
    }
    result.push(item);
  }

  return result
    .sort((a, b) => new Date(itemTimestamp(a)).getTime() - new Date(itemTimestamp(b)).getTime())
    .slice(-limit);
}

function createCommand(payload) {
  const parameters = payload.parameters && typeof payload.parameters === 'object' ? { ...payload.parameters } : {};
  delete parameters.password;
  delete parameters.controlPassword;
  delete parameters.liveControlPassword;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    command: text(pick(payload, 'command', 'tipo', 'Tipo'), 'Unknown'),
    status: 'Pendente',
    requestedBy: text(pick(payload, 'requestedBy', 'solicitadoPor'), 'Dashboard'),
    reason: text(pick(payload, 'reason', 'motivo'), ''),
    runtime: normalizeRuntime(pick(payload, 'runtime', 'Runtime')),
    runtimeApplyMode: text(pick(payload, 'runtimeApplyMode', 'RuntimeApplyMode'), null),
    worker: text(pick(payload, 'worker', 'Worker'), null),
    parameters,
    rawPayload: payload
  };
}

function acknowledgeCommand(commandId, payload = {}) {
  const item = store.commands.find(command => command.id === commandId);
  if (!item) return null;
  item.status = text(pick(payload, 'status', 'Status'), 'Processado');
  item.result = text(pick(payload, 'result', 'Result', 'message', 'Message'), null);
  item.processedBy = text(pick(payload, 'processedBy', 'ProcessedBy'), 'RPA');
  item.processedAt = new Date().toISOString();
  item.ackPayload = payload;
  return item;
}

function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return sendFile(res, filePath);
  return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = normalizePathname(requestUrl.pathname);

  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    pruneHistory();
    return sendJson(res, 200, {
      ok: true,
      status: 'online',
      service: 'external-telemetry-dashboard',
      storageMode: 'memory-only-24h',
      retentionHours: HISTORY_RETENTION_HOURS,
      latestHeartbeat: store.latest?.heartbeat || null,
      latestReceivedAt: store.latestReceivedAt || null,
      historyItems: store.history.length,
      dbHistoryItems: store.dbHistory.length,
      commandItems: store.commands.length,
      telemetryAuthRequired: REQUIRE_TELEMETRY_KEY,
      time: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && (pathname === '/api/telemetry/latest' || pathname === '/api/latest')) {
    if (!store.latest) return sendJson(res, 404, { status: 'empty', message: 'No telemetry received yet.', storageMode: 'memory-only-24h' });
    return sendJson(res, 200, store.latest, { 'X-Latest-Received-At': store.latestReceivedAt || '' });
  }

  if (req.method === 'GET' && (pathname === '/api/debug/latest' || pathname === '/api/raw/latest')) {
    if (!store.latest) return sendJson(res, 404, { status: 'empty', message: 'No telemetry received yet.', storageMode: 'memory-only-24h' });
    return sendJson(res, 200, { ok: true, storageMode: 'memory-only-24h', receivedAt: store.latestReceivedAt, rawPayload: store.latest, rawBody: store.latestRawBody });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    pruneHistory();
    return sendJson(res, 200, { ok: true, storageMode: 'memory-only-24h', retentionHours: HISTORY_RETENTION_HOURS, latest: store.latest, historyCount: store.history.length, dbHistoryCount: store.dbHistory.length, commands: store.commands.slice(-50) });
  }

  if (req.method === 'GET' && (pathname === '/api/telemetry/history' || pathname === '/api/history')) {
    const defaultTake = Math.min(MAX_HISTORY + MAX_DB_HISTORY, 25000);
    const take = Math.min(number(requestUrl.searchParams.get('take') || requestUrl.searchParams.get('limit'), defaultTake), defaultTake);
    const items = mergedHistoryItems(take);
    if (pathname === '/api/history') return sendJson(res, 200, { ok: true, storageMode: 'memory-only-24h', retentionHours: HISTORY_RETENTION_HOURS, items: items.slice().reverse() });
    return sendJson(res, 200, items);
  }

  if (req.method === 'GET' && pathname === '/api/db-history') {
    const take = Math.min(number(requestUrl.searchParams.get('take'), MAX_DB_HISTORY), MAX_DB_HISTORY);
    pruneHistory();
    return sendJson(res, 200, { ok: true, storageMode: 'memory-only-24h', retentionHours: HISTORY_RETENTION_HOURS, items: store.dbHistory.slice(-take).map(x => x.item) });
  }

  if (req.method === 'GET' && pathname === '/api/commands') {
    return sendJson(res, 200, store.commands.slice().reverse());
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const take = Math.min(number(requestUrl.searchParams.get('take'), 120), MAX_LOGS);
    return sendJson(res, 200, store.logs.slice(-take));
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    if (store.latest) res.write(`data: ${JSON.stringify({ type: 'telemetry', latest: store.latest, receivedAt: store.latestReceivedAt })}\n\n`);
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  if (req.method === 'POST' && ['/api/telemetry', '/telemetry', '/api/metrics', '/api/state'].includes(pathname)) {
    if (REQUIRE_TELEMETRY_KEY && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized telemetry write.' });
    return handleJson(req, res, (parsed, rawBody) => {
      // Sem normalização de telemetria: o dashboard guarda e devolve exactamente o objecto recebido.
      const item = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { rawBody: String(rawBody || '') };
      const receivedAt = new Date().toISOString();
      store.latest = item;
      store.latestReceivedAt = receivedAt;
      store.latestRawBody = String(rawBody || '');
      store.history.push({ receivedAt, item });
      pruneHistory();
      addLog('INF', `Telemetria recebida | Exec=${item.idExecucao || item.Id_Execucao || '-'} | Estado=${item.estadoFinal || item.Estado_Final || '-'} | Progresso=${item.percentagemConcluida ?? '-'}%`);
      broadcast({ type: 'telemetry', latest: item, receivedAt });
      return sendJson(res, 202, { ok: true, storageMode: 'memory-only-24h', retentionHours: HISTORY_RETENTION_HOURS, idExecucao: item.idExecucao || item.Id_Execucao || null, receivedAt, shownInDashboard: true });
    });
  }

  if (req.method === 'POST' && pathname === '/api/db-history/sync') {
    if (REQUIRE_TELEMETRY_KEY && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized history sync.' });
    return handleJson(req, res, (parsed) => {
      const rawItems = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
      const receivedAt = new Date().toISOString();
      const rows = rawItems
        .filter(item => item && typeof item === 'object' && !Array.isArray(item));

      for (const item of rows) {
        store.dbHistory.push({ receivedAt: itemTimestamp(item, receivedAt), item });
      }

      pruneHistory();
      addLog('INF', `Histórico SQL sincronizado | Linhas=${rows.length} | Retenção=${HISTORY_RETENTION_HOURS}h`);
      broadcast({ type: 'db-history', count: rows.length });
      return sendJson(res, 202, { ok: true, storageMode: 'memory-only-24h', retentionHours: HISTORY_RETENTION_HOURS, rowsReceived: rows.length, rowsStored: store.dbHistory.length, receivedAt });
    });
  }

  if (req.method === 'POST' && pathname === '/api/commands') {
    return handleJson(req, res, (parsed) => {
      if (REQUIRE_COMMAND_SECRET && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized command write.' });
      if (!isControlAuthorized(req, parsed || {})) return sendJson(res, 403, { ok: false, error: 'Invalid live control password.' });
      const item = createCommand(parsed || {});
      store.commands.push(item);
      store.commands = store.commands.slice(-MAX_COMMANDS);
      addLog('INF', `Comando registado | ${item.command}`);
      broadcast({ type: 'command', command: item });
      return sendJson(res, 202, item);
    });
  }

  if (req.method === 'POST' && pathname.startsWith('/api/commands/') && pathname.endsWith('/ack')) {
    if (REQUIRE_COMMAND_SECRET && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized command ack.' });
    const commandId = decodeURIComponent(pathname.split('/')[3] || '');
    return handleJson(req, res, (parsed) => {
      const item = acknowledgeCommand(commandId, parsed || {});
      if (!item) return sendJson(res, 404, { ok: false, error: 'Command not found.' });
      addLog('INF', `Comando actualizado | ${item.command} | ${item.status}`);
      broadcast({ type: 'command', command: item });
      return sendJson(res, 200, { ok: true, command: item });
    });
  }

  if (req.method === 'GET') return serveStatic(res, pathname);
  return sendJson(res, 405, { ok: false, error: 'Method not allowed', method: req.method, pathname });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[INF] Dashboard externo iniciado em http://0.0.0.0:${PORT}`);
  console.log(`[INF] StorageMode=memory-only-24h | Retention=${HISTORY_RETENTION_HOURS}h | POST /api/telemetry | POST /api/db-history/sync | AuthObrigatoria=${REQUIRE_TELEMETRY_KEY}`);
  console.log('[INF] Live Control: POST /api/commands | Senha via payload/header');
});
