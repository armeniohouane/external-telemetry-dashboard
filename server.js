'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const TELEMETRY_KEY = process.env.TELEMETRY_KEY || process.env.DASHBOARD_SHARED_SECRET || '';
const LIVE_CONTROL_PASSWORD = process.env.LIVE_CONTROL_PASSWORD || 'Zeus';
const REQUIRE_COMMAND_SECRET = String(process.env.REQUIRE_COMMAND_SECRET || 'false').toLowerCase() === 'true';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || process.env.MAX_HISTORY_ITEMS || 500);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'telemetry-store.json');
const LEGACY_HISTORY_FILE = path.join(DATA_DIR, 'telemetry.jsonl');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!TELEMETRY_KEY || TELEMETRY_KEY.length < 16) {
  console.warn('[WARN] TELEMETRY_KEY/DASHBOARD_SHARED_SECRET não definido ou curto. Em Render público, configure uma chave forte.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });

let store = loadStore();
let eventClients = new Set();

function defaultStore() {
  return { latest: null, history: [], commands: [], logs: [] };
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      return {
        latest: parsed.latest || null,
        history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY) : [],
        commands: Array.isArray(parsed.commands) ? parsed.commands.slice(-250) : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-300) : []
      };
    }

    if (fs.existsSync(LEGACY_HISTORY_FILE)) {
      const lines = fs.readFileSync(LEGACY_HISTORY_FILE, 'utf8').split(/\r?\n/).filter(Boolean).slice(-MAX_HISTORY);
      const history = lines.map(x => safeJsonParse(x)).filter(Boolean);
      return { latest: history[history.length - 1] || null, history, commands: [], logs: [] };
    }
  } catch (error) {
    console.warn('[WARN] Falha ao carregar dados persistidos:', error.message);
  }
  return defaultStore();
}

function persistStore() {
  try {
    trimStore();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.warn('[WARN] Falha ao persistir dados:', error.message);
  }
}

function trimStore() {
  store.history = (store.history || []).slice(-MAX_HISTORY);
  store.commands = (store.commands || []).slice(-250);
  store.logs = (store.logs || []).slice(-300);
}

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
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
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function timingSafeEqualText(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(req) {
  if (!TELEMETRY_KEY) return true;
  const headers = req.headers || {};
  const candidates = [
    headers['x-telemetry-key'],
    headers['x-dashboard-secret'],
    headers['authorization'] ? String(headers['authorization']).replace(/^Bearer\s+/i, '') : ''
  ];
  return candidates.some(value => timingSafeEqualText(value, TELEMETRY_KEY));
}

function isControlAuthorized(req, payload = {}) {
  const headers = req.headers || {};
  const candidates = [
    payload.controlPassword,
    payload.password,
    payload.liveControlPassword,
    headers['x-control-password'],
    headers['x-live-control-password']
  ];
  return candidates.some(value => timingSafeEqualText(value, LIVE_CONTROL_PASSWORD));
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function percent(part, total) {
  const p = number(part);
  const t = number(total);
  return t <= 0 ? 0 : Math.round((p / t) * 1000) / 10;
}

function normalizeRuntime(value) {
  const text = String(value || 'web').toLowerCase();
  if (text.includes('api')) return 'api';
  if (text.includes('auto')) return 'auto';
  return 'web';
}

function safePublicText(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).slice(0, 160);
}

function sanitizeErrorTypes(value) {
  const result = {};
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const [key, raw] of Object.entries(source)) {
    const cleanKey = safePublicText(key, 'Erro Geral');
    result[cleanKey] = number(raw);
  }
  return result;
}

function sanitizeWorkers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((worker, index) => ({
    id: safePublicText(pick(worker, 'id', 'Id', 'workerId', 'WorkerId'), `Worker-${String(index + 1).padStart(2, '0')}`),
    estado: safePublicText(pick(worker, 'estado', 'Estado', 'status', 'Status'), 'Desconhecido'),
    processando: safePublicText(pick(worker, 'campoAtual', 'CampoAtual', 'currentField', 'CurrentField', 'processando', 'Processando'), 'Sanitizado'),
    filaLocal: number(pick(worker, 'filaLocal', 'FilaLocal', 'localQueue', 'LocalQueue')),
    modelo: safePublicText(pick(worker, 'modelo', 'Modelo', 'model', 'Model'), null),
    ultimoHeartbeat: pick(worker, 'ultimoHeartbeat', 'UltimoHeartbeat', 'heartbeat', 'Heartbeat') || null
  }));
}

function sanitizeTimeline(value, data) {
  if (Array.isArray(value) && value.length) {
    return value.slice(-80).map((x, index) => ({
      label: safePublicText(pick(x, 'label', 'Label'), String(index + 1)),
      timestamp: pick(x, 'timestamp', 'Timestamp') || null,
      processed: number(pick(x, 'processed', 'Processados', 'cifsProcessados', 'CifsProcessados')),
      success: number(pick(x, 'success', 'Sucesso', 'cifsSucesso', 'CifsSucesso')),
      notFound: number(pick(x, 'notFound', 'NaoEncontrado', 'cifsNaoEncontrado', 'CifsNaoEncontrado')),
      errors: number(pick(x, 'errors', 'Erros', 'cifsComErro', 'CifsComErro')),
      progress: number(pick(x, 'progress', 'Progresso', 'progressoPercentual', 'ProgressoPercentual'))
    }));
  }

  const now = new Date();
  return [{
    label: now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
    timestamp: now.toISOString(),
    processed: number(pick(data, 'cifsProcessados', 'CifsProcessados', 'CIFsProcessados')),
    success: number(pick(data, 'cifsSucesso', 'CifsSucesso', 'CIFsSucesso')),
    notFound: number(pick(data, 'cifsNaoEncontrado', 'CifsNaoEncontrado', 'CIFsNaoEncontrado')),
    errors: number(pick(data, 'cifsComErro', 'CifsComErro', 'CIFsComErro')),
    progress: percent(pick(data, 'cifsProcessados', 'CifsProcessados', 'CIFsProcessados'), pick(data, 'cifsRecebidos', 'CifsRecebidos', 'CIFsRecebidos'))
  }];
}

function normalizeTelemetry(payload) {
  const now = new Date().toISOString();
  const metrics = payload.metrics || payload.Metrics || {};
  const data = payload.data || payload.Data || payload;
  const source = { ...metrics, ...data };

  const cifsRecebidos = number(pick(source, 'cifsRecebidos', 'CifsRecebidos', 'CIFsRecebidos', 'CIFs_Recebidos'));
  const cifsProcessados = number(pick(source, 'cifsProcessados', 'CifsProcessados', 'CIFsProcessados', 'CIFs_Processados'));
  const cifsSucesso = number(pick(source, 'cifsSucesso', 'CifsSucesso', 'CIFsSucesso', 'CIFs_Sucesso'));
  const cifsNaoEncontrado = number(pick(source, 'cifsNaoEncontrado', 'CifsNaoEncontrado', 'CIFsNaoEncontrado', 'CIFs_Nao_Encontrado'));
  const cifsInvalidos = number(pick(source, 'cifsInvalidos', 'CifsInvalidos', 'CIFsInvalidos', 'CIFs_Invalidos'));
  const cifsComErro = number(pick(source, 'cifsComErro', 'CifsComErro', 'CIFsComErro', 'CIFs_Com_Erro'));
  const ficheirosRecebidos = number(pick(source, 'ficheirosRecebidos', 'FicheirosRecebidos', 'Ficheiros_Recebidos', 'ficheirosNaFila', 'FicheirosNaFila', 'Uploads'));
  const ficheirosAvaliados = number(pick(source, 'ficheirosAvaliados', 'FicheirosAvaliados', 'Ficheiros_Avaliados'));
  const ficheirosFtp550 = number(pick(source, 'ficheirosFtp550', 'FicheirosFtp550', 'Ficheiros_FTP_550'));
  const uploads = number(pick(source, 'uploads', 'Uploads', 'Uploads_Direct_Line', 'requestsGemini', 'RequestsGemini'));
  const errosDirectLine = number(pick(source, 'errosDirectLine', 'ErrosDirectLine', 'Erros_Direct_Line', 'errosApi', 'ErrosApi'));
  const normalizacoesSolicitadas = number(pick(source, 'normalizacoesSolicitadas', 'NormalizacoesSolicitadas', 'Normalizacoes_Solicitadas'));
  const normalizacoesComSucesso = number(pick(source, 'normalizacoesComSucesso', 'NormalizacoesComSucesso', 'Normalizacoes_Com_Sucesso'));

  const item = {
    receivedAt: now,
    instanceName: safePublicText(pick(source, 'instanceName', 'InstanceName'), 'Render'),
    idExecucao: safePublicText(pick(source, 'idExecucao', 'IdExecucao', 'Id_Execucao', 'currentExecutionId', 'CurrentExecutionId'), now.replace(/[-:TZ.]/g, '').slice(0, 14)),
    data: pick(source, 'data', 'Data', 'dataHoraOrigem', 'DataHoraOrigem', 'sentAt', 'SentAt') || now,
    estadoFinal: safePublicText(pick(source, 'estadoFinal', 'EstadoFinal', 'Estado_Final', 'estadoAtual', 'EstadoAtual', 'estado', 'Estado', 'status', 'Status'), 'Recebido'),
    runtimeActual: normalizeRuntime(pick(source, 'runtimeActual', 'RuntimeActual', 'Runtime_Actual', 'runtime')),
    runtimeSolicitado: normalizeRuntime(pick(source, 'runtimeSolicitado', 'RuntimeSolicitado', 'Runtime_Solicitado', 'runtime')),
    runtimeModo: safePublicText(pick(source, 'runtimeModo', 'RuntimeModo'), null),

    cifsRecebidos,
    cifsProcessados,
    cifsSucesso,
    cifsNaoEncontrado,
    cifsInvalidos,
    cifsComErro,
    ficheirosRecebidos,
    ficheirosAvaliados,
    ficheirosFtp550,
    uploads,
    timeoutsAgente: number(pick(source, 'timeoutsAgente', 'TimeoutsAgente', 'Timeouts_Agente')),
    errosDirectLine,
    normalizacoesSolicitadas,
    normalizacoesComSucesso,
    tempoMedioPorCif: number(pick(source, 'tempoMedioPorCif', 'TempoMedioPorCif', 'Tempo_Medio_Por_CIF')),
    tempoMedioRespostaAgente: number(pick(source, 'tempoMedioRespostaAgente', 'TempoMedioRespostaAgente', 'Tempo_Medio_Resposta_Agente')),
    tempoBackoffTotalMinutos: number(pick(source, 'tempoBackoffTotalMinutos', 'TempoBackoffTotalMinutos', 'Tempo_Backoff_Total_Minutos')),

    modeloActual: safePublicText(pick(source, 'modeloActual', 'ModeloActual', 'modelo', 'Modelo'), null),
    modeloSeleccionado: safePublicText(pick(source, 'modeloSeleccionado', 'ModeloSeleccionado'), null),
    fallbackCount: number(pick(source, 'fallbackCount', 'FallbackCount', 'fallbacks', 'Fallbacks')),
    errosGlobaisConsecutivos: number(pick(source, 'errosGlobaisConsecutivos', 'ErrosGlobaisConsecutivos')),
    ultimaRequisicao: pick(source, 'ultimaRequisicao', 'UltimaRequisicao') || null,
    proximaRequisicaoPermitida: pick(source, 'proximaRequisicaoPermitida', 'ProximaRequisicaoPermitida') || null,
    heartbeat: pick(source, 'heartbeat', 'Heartbeat', 'ultimoHeartbeat', 'UltimoHeartbeat') || now,
    ultimoEvento: safePublicText(pick(source, 'ultimoEvento', 'UltimoEvento'), null),
    categoriaUltimoErro: safePublicText(pick(source, 'categoriaUltimoErro', 'CategoriaUltimoErro', 'lastErrorCategory', 'LastErrorCategory'), null),

    // Campos sensíveis não são propagados no dashboard externo.
    cifActual: null,
    ficheiroActual: null,
    campoActual: safePublicText(pick(source, 'campoActual', 'campoAtual', 'CampoActual', 'CampoAtual', 'currentField', 'CurrentField'), null),

    apiWorkersActivos: number(pick(source, 'apiWorkersActivos', 'ApiWorkersActivos', 'Api_Workers_Activos', 'workersActive')),
    apiWorkersTotal: number(pick(source, 'apiWorkersTotal', 'ApiWorkersTotal', 'Api_Workers_Total', 'workersTotal')),
    apiWorkersBackoff: number(pick(source, 'apiWorkersBackoff', 'ApiWorkersBackoff', 'Api_Workers_Backoff', 'workersBackoff')),
    apiBatchSize: number(pick(source, 'apiBatchSize', 'ApiBatchSize', 'Api_Batch_Size', 'batchSize')),
    apiRpmActual: number(pick(source, 'apiRpmActual', 'ApiRpmActual', 'Api_RPM_Actual', 'rpmActual')),
    apiRpmLimit: number(pick(source, 'apiRpmLimit', 'ApiRpmLimit', 'Api_RPM_Limit', 'rpmLimit')),
    apiRpdHoje: number(pick(source, 'apiRpdHoje', 'ApiRpdHoje', 'Api_RPD_Hoje', 'rpdToday')),
    apiRpdLimit: number(pick(source, 'apiRpdLimit', 'ApiRpdLimit', 'Api_RPD_Limit', 'rpdLimit')),
    apiTpmActual: number(pick(source, 'apiTpmActual', 'ApiTpmActual', 'Api_TPM_Actual', 'tpmActual')),
    apiTpmLimit: number(pick(source, 'apiTpmLimit', 'ApiTpmLimit', 'Api_TPM_Limit', 'tpmLimit')),
    apiTpdHoje: number(pick(source, 'apiTpdHoje', 'ApiTpdHoje', 'Api_TPD_Hoje', 'tpdToday')),
    apiTpdLimit: number(pick(source, 'apiTpdLimit', 'ApiTpdLimit', 'Api_TPD_Limit', 'tpdLimit')),
    apiRequestsHoje: number(pick(source, 'apiRequestsHoje', 'ApiRequestsHoje', 'apiRequestsToday', 'requestsToday')),
    apiInputTokens: number(pick(source, 'apiInputTokens', 'ApiInputTokens', 'inputTokens')),
    apiOutputTokens: number(pick(source, 'apiOutputTokens', 'ApiOutputTokens', 'outputTokens')),
    apiCustoEstimadoUsd: number(pick(source, 'apiCustoEstimadoUsd', 'ApiCustoEstimadoUsd', 'estimatedCostUsd')),
    apiQuotaRestantePercent: number(pick(source, 'apiQuotaRestantePercent', 'ApiQuotaRestantePercent', 'quotaRemainingPercent')),

    timeline: sanitizeTimeline(pick(source, 'timeline', 'Timeline'), source),
    errosPorTipo: sanitizeErrorTypes(pick(source, 'errosPorTipo', 'ErrosPorTipo', 'errorsByType', 'ErrorsByType')),
    workers: sanitizeWorkers(pick(source, 'workers', 'Workers'))
  };

  item.progressoPercentual = number(pick(source, 'progressoPercentual', 'ProgressoPercentual'), percent(cifsProcessados, cifsRecebidos));
  item.sucessoPercentual = number(pick(source, 'sucessoPercentual', 'SucessoPercentual'), percent(cifsSucesso, cifsProcessados));

  return item;
}

function validateTelemetry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Payload deve ser um objecto JSON.';
  return null;
}

function createCommand(payload) {
  const now = new Date().toISOString();
  const parameters = payload.parameters && typeof payload.parameters === 'object' ? { ...payload.parameters } : {};
  delete parameters.controlPassword;
  delete parameters.password;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: now,
    command: safePublicText(pick(payload, 'command', 'tipo', 'Tipo'), 'Unknown'),
    status: 'Pendente',
    requestedBy: safePublicText(pick(payload, 'requestedBy', 'solicitadoPor'), 'Dashboard'),
    reason: safePublicText(pick(payload, 'reason', 'motivo'), ''),
    runtime: normalizeRuntime(pick(payload, 'runtime', 'Runtime')),
    runtimeApplyMode: safePublicText(pick(payload, 'runtimeApplyMode', 'RuntimeApplyMode'), null),
    worker: safePublicText(pick(payload, 'worker', 'Worker'), null),
    parameters
  };
}

function acknowledgeCommand(commandId, payload = {}) {
  const item = (store.commands || []).find(command => command.id === commandId);
  if (!item) return null;
  item.status = safePublicText(pick(payload, 'status', 'Status'), 'Processado');
  item.result = safePublicText(pick(payload, 'result', 'Result', 'message', 'Message'), null);
  item.processedBy = safePublicText(pick(payload, 'processedBy', 'ProcessedBy'), 'RPA');
  item.processedAt = new Date().toISOString();
  return item;
}


function addLog(level, message, extra = {}) {
  const item = { timestamp: new Date().toISOString(), level, message, ...extra };
  store.logs.push(item);
  store.logs = store.logs.slice(-300);
  broadcastEvent(item);
}

function broadcastEvent(item) {
  const payload = `data: ${JSON.stringify(item)}\n\n`;
  for (const res of eventClients) {
    try { res.write(payload); } catch { eventClients.delete(res); }
  }
}

async function handlePostJson(req, res, handler) {
  let body;
  try { body = await readRequestBody(req); }
  catch (error) { return sendJson(res, 413, { ok: false, error: error.message }); }

  const parsed = safeJsonParse(body || '{}');
  if (!parsed) return sendJson(res, 400, { ok: false, error: 'JSON inválido.' });
  return handler(parsed);
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return sendFile(res, filePath);
  return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'online',
      service: 'external-telemetry-dashboard',
      latestHeartbeat: store.latest?.heartbeat || null,
      historyItems: store.history.length,
      commandItems: store.commands.length,
      time: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'external-telemetry-dashboard', time: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/telemetry/latest') {
    if (!store.latest) return sendJson(res, 404, { status: 'empty', message: 'No telemetry received yet.' });
    return sendJson(res, 200, store.latest);
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, { ok: true, latest: store.latest, historyCount: store.history.length });
  }

  if (req.method === 'GET' && (pathname === '/api/telemetry/history' || pathname === '/api/history')) {
    const take = Math.min(number(requestUrl.searchParams.get('take') || requestUrl.searchParams.get('limit'), MAX_HISTORY), MAX_HISTORY);
    const items = store.history.slice(-take);
    if (pathname === '/api/history') return sendJson(res, 200, { ok: true, items: items.slice().reverse() });
    return sendJson(res, 200, items);
  }

  if (req.method === 'GET' && pathname === '/api/commands') {
    return sendJson(res, 200, store.commands.slice().reverse());
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const take = Math.min(number(requestUrl.searchParams.get('take'), 120), 300);
    return sendJson(res, 200, store.logs.slice(-take));
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff'
    });
    res.write(': connected\n\n');
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/telemetry') {
    if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized telemetry write.' });
    return handlePostJson(req, res, (parsed) => {
      const validationError = validateTelemetry(parsed);
      if (validationError) return sendJson(res, 400, { ok: false, error: validationError });
      const item = normalizeTelemetry(parsed);
      store.latest = item;
      store.history.push(item);
      addLog('INF', `Telemetria recebida | Estado=${item.estadoFinal || '-'} | Progresso=${item.progressoPercentual || 0}%`);
      persistStore();
      return sendJson(res, 202, { ok: true, idExecucao: item.idExecucao, receivedAt: item.receivedAt });
    });
  }

  if (req.method === 'POST' && pathname === '/api/commands') {
    return handlePostJson(req, res, (parsed) => {
      if (REQUIRE_COMMAND_SECRET && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized command write.' });
      if (!isControlAuthorized(req, parsed)) return sendJson(res, 403, { ok: false, error: 'Invalid live control password.' });
      const item = createCommand(parsed || {});
      store.commands.push(item);
      addLog('INF', `Comando registado | ${item.command}`);
      persistStore();
      return sendJson(res, 202, item);
    });
  }

  if (req.method === 'POST' && pathname.startsWith('/api/commands/') && pathname.endsWith('/ack')) {
    if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized command ack.' });
    const commandId = decodeURIComponent(pathname.split('/')[3] || '');
    return handlePostJson(req, res, (parsed) => {
      const item = acknowledgeCommand(commandId, parsed || {});
      if (!item) return sendJson(res, 404, { ok: false, error: 'Command not found.' });
      addLog('INF', `Comando actualizado | ${item.command} | ${item.status}`);
      persistStore();
      return sendJson(res, 200, { ok: true, command: item });
    });
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);
  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[INF] Dashboard externo iniciado em http://0.0.0.0:${PORT}`);
  console.log('[INF] UI: GET /');
  console.log('[INF] Telemetria: POST /api/telemetry');
});
