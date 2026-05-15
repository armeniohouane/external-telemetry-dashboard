'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 25 * 1024 * 1024);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || process.env.MAX_HISTORY_ITEMS || 300);
const MAX_COMMANDS = Number(process.env.MAX_COMMANDS || 300);
const MAX_LOGS = Number(process.env.MAX_LOGS || 300);

// Dashboard urgente: memória apenas. Não lê nem escreve telemetry-store.json.
// Se o Render reiniciar/redeployar, o latest/histórico/comandos desaparecem, mas a recepção em tempo real não fica bloqueada por I/O.
const REQUIRE_TELEMETRY_KEY = String(process.env.REQUIRE_TELEMETRY_KEY || 'false').toLowerCase() === 'true';
const TELEMETRY_KEY = process.env.TELEMETRY_KEY || process.env.DASHBOARD_SHARED_SECRET || process.env.API_KEY || '';
const LIVE_CONTROL_PASSWORD = process.env.LIVE_CONTROL_PASSWORD || 'Zeus';
const REQUIRE_COMMAND_SECRET = String(process.env.REQUIRE_COMMAND_SECRET || 'false').toLowerCase() === 'true';

const store = { latest: null, history: [], commands: [], logs: [] };
const eventClients = new Set();

function normalizePathname(value) {
  const clean = String(value || '/').replace(/\/+/g, '/');
  if (clean === '/') return '/';
  return clean.replace(/\/$/, '') || '/';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Telemetry-Key,X-Dashboard-Secret,X-Control-Password,X-Live-Control-Password,X-RPA-Source,X-RPA-Instance',
    'X-Content-Type-Options': 'nosniff'
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

function percent(part, total) {
  const p = number(part);
  const t = number(total);
  return t <= 0 ? 0 : Math.round((p / t) * 1000) / 10;
}

function normalizeRuntime(value) {
  const raw = String(value || 'web').toLowerCase();
  if (raw.includes('api')) return 'api';
  return 'web';
}

function mergeSources(payload) {
  const metrics = payload && typeof payload.metrics === 'object' ? payload.metrics : {};
  const Metrics = payload && typeof payload.Metrics === 'object' ? payload.Metrics : {};
  const data = payload && typeof payload.data === 'object' ? payload.data : {};
  const Data = payload && typeof payload.Data === 'object' ? payload.Data : {};
  const snapshot = payload && typeof payload.snapshot === 'object' ? payload.snapshot : {};
  const Snapshot = payload && typeof payload.Snapshot === 'object' ? payload.Snapshot : {};
  const snapshotMonitor = payload && typeof payload.snapshotMonitor === 'object' ? payload.snapshotMonitor : {};
  return { ...metrics, ...Metrics, ...data, ...Data, ...snapshot, ...Snapshot, ...snapshotMonitor, ...(payload || {}) };
}

function objectNumberMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) result[key] = number(raw);
  return result;
}

function normalizeWorkers(value) {
  if (!Array.isArray(value)) return [];
  return value.map((worker, index) => ({
    id: text(pick(worker, 'id', 'Id', 'workerId', 'WorkerId'), `Worker-${index + 1}`),
    estado: text(pick(worker, 'estado', 'Estado', 'status', 'Status'), 'Desconhecido'),
    processando: text(pick(worker, 'processando', 'Processando', 'campoAtual', 'CampoAtual', 'campoActual', 'CampoActual', 'currentField', 'CurrentField'), '--'),
    filaLocal: number(pick(worker, 'filaLocal', 'FilaLocal', 'localQueue', 'LocalQueue')),
    modelo: text(pick(worker, 'modelo', 'Modelo', 'model', 'Model'), null),
    ultimoHeartbeat: pick(worker, 'ultimoHeartbeat', 'UltimoHeartbeat', 'heartbeat', 'Heartbeat') || null,
    raw: worker
  }));
}

function normalizeTimeline(value, source) {
  if (Array.isArray(value) && value.length) return value;
  const now = new Date().toISOString();
  return [{
    label: new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
    timestamp: now,
    processed: number(pick(source, 'cifsProcessados', 'CifsProcessados', 'CIFsProcessados', 'CIFs_Processados')),
    success: number(pick(source, 'cifsSucesso', 'CifsSucesso', 'CIFsSucesso', 'CIFs_Sucesso')),
    notFound: number(pick(source, 'cifsNaoEncontrado', 'CifsNaoEncontrado', 'CIFsNaoEncontrado', 'CIFs_Nao_Encontrado')),
    errors: number(pick(source, 'cifsComErro', 'CifsComErro', 'CIFsComErro', 'CIFs_Com_Erro')),
    progress: percent(
      pick(source, 'cifsProcessados', 'CifsProcessados', 'CIFsProcessados', 'CIFs_Processados'),
      pick(source, 'cifsRecebidos', 'CifsRecebidos', 'CIFsRecebidos', 'CIFs_Recebidos')
    )
  }];
}

function normalizeTelemetry(payload, req) {
  const now = new Date().toISOString();
  const source = mergeSources(payload && typeof payload === 'object' ? payload : {});

  const cifsRecebidos = number(pick(source, 'cifsRecebidos', 'CifsRecebidos', 'CIFsRecebidos', 'CIFs_Recebidos'));
  const cifsProcessados = number(pick(source, 'cifsProcessados', 'CifsProcessados', 'CIFsProcessados', 'CIFs_Processados'));
  const cifsSucesso = number(pick(source, 'cifsSucesso', 'CifsSucesso', 'CIFsSucesso', 'CIFs_Sucesso'));
  const cifsNaoEncontrado = number(pick(source, 'cifsNaoEncontrado', 'CifsNaoEncontrado', 'CIFsNaoEncontrado', 'CIFs_Nao_Encontrado'));
  const cifsInvalidos = number(pick(source, 'cifsInvalidos', 'CifsInvalidos', 'CIFsInvalidos', 'CIFs_Invalidos'));
  const cifsComErro = number(pick(source, 'cifsComErro', 'CifsComErro', 'CIFsComErro', 'CIFs_Com_Erro'));
  const ficheirosAvaliados = number(pick(source, 'ficheirosAvaliados', 'FicheirosAvaliados', 'Ficheiros_Avaliados'));
  const ficheirosRecebidos = number(pick(source, 'ficheirosRecebidos', 'FicheirosRecebidos', 'Ficheiros_Recebidos'), ficheirosAvaliados);

  const item = {
    receivedAt: now,
    storageMode: 'memory-only',
    acceptedWithoutTelemetryAuth: !REQUIRE_TELEMETRY_KEY,
    receivedHeaders: {
      userAgent: req.headers['user-agent'] || null,
      contentType: req.headers['content-type'] || null,
      contentLength: req.headers['content-length'] || null,
      xTelemetryKeyPresent: Boolean(req.headers['x-telemetry-key']),
      xDashboardSecretPresent: Boolean(req.headers['x-dashboard-secret']),
      authorizationPresent: Boolean(req.headers.authorization),
      xRpaSource: req.headers['x-rpa-source'] || null,
      xRpaInstance: req.headers['x-rpa-instance'] || null
    },

    instanceName: text(pick(source, 'instanceName', 'InstanceName'), 'RPA Clientes Irregulares'),
    idExecucao: text(pick(source, 'idExecucao', 'IdExecucao', 'Id_Execucao', 'currentExecutionId', 'CurrentExecutionId'), now.replace(/[-:TZ.]/g, '').slice(0, 14)),
    data: pick(source, 'data', 'Data', 'dataHoraOrigem', 'DataHoraOrigem', 'sentAt', 'SentAt') || now,
    estadoFinal: text(pick(source, 'estadoFinal', 'EstadoFinal', 'Estado_Final', 'estadoAtual', 'EstadoAtual', 'estado', 'Estado', 'status', 'Status'), 'Recebido'),
    runtimeActual: normalizeRuntime(pick(source, 'runtimeActual', 'RuntimeActual', 'Runtime_Actual', 'runtime', 'Runtime')),
    runtimeSolicitado: normalizeRuntime(pick(source, 'runtimeSolicitado', 'RuntimeSolicitado', 'Runtime_Solicitado', 'runtime', 'Runtime')),
    runtimeModo: text(pick(source, 'runtimeModo', 'RuntimeModo', 'modo', 'Modo'), null),

    cifsRecebidos,
    cifsProcessados,
    cifsSucesso,
    cifsNaoEncontrado,
    cifsInvalidos,
    cifsComErro,
    ficheirosRecebidos,
    ficheirosAvaliados,
    ficheirosFtp550: number(pick(source, 'ficheirosFtp550', 'FicheirosFtp550', 'Ficheiros_FTP_550')),
    uploads: number(pick(source, 'uploads', 'Uploads', 'Uploads_Direct_Line', 'requestsGemini', 'RequestsGemini')),
    timeoutsAgente: number(pick(source, 'timeoutsAgente', 'TimeoutsAgente', 'Timeouts_Agente')),
    errosDirectLine: number(pick(source, 'errosDirectLine', 'ErrosDirectLine', 'Erros_Direct_Line', 'errosApi', 'ErrosApi')),
    normalizacoesSolicitadas: number(pick(source, 'normalizacoesSolicitadas', 'NormalizacoesSolicitadas', 'Normalizacoes_Solicitadas')),
    normalizacoesComSucesso: number(pick(source, 'normalizacoesComSucesso', 'NormalizacoesComSucesso', 'Normalizacoes_Com_Sucesso')),
    tempoMedioPorCif: number(pick(source, 'tempoMedioPorCif', 'TempoMedioPorCif', 'tempoMedioPorCIF', 'TempoMedioPorCIF', 'Tempo_Medio_Por_CIF')),
    tempoMedioRespostaAgente: number(pick(source, 'tempoMedioRespostaAgente', 'TempoMedioRespostaAgente', 'Tempo_Medio_Resposta_Agente')),
    tempoBackoffTotalMinutos: number(pick(source, 'tempoBackoffTotalMinutos', 'TempoBackoffTotalMinutos', 'backoffGlobalMinutos', 'BackoffGlobalMinutos')),

    modeloActual: text(pick(source, 'modeloActual', 'ModeloActual', 'modeloAlvo', 'ModeloAlvo', 'modelo', 'Modelo'), null),
    modeloSeleccionado: text(pick(source, 'modeloSeleccionado', 'ModeloSeleccionado', 'modeloSelecionado', 'ModeloSelecionado'), null),
    fallbackCount: number(pick(source, 'fallbackCount', 'FallbackCount', 'fallbacks', 'Fallbacks')),
    errosGlobaisConsecutivos: number(pick(source, 'errosGlobaisConsecutivos', 'ErrosGlobaisConsecutivos', 'errosConsecutivosGlobais', 'ErrosConsecutivosGlobais')),
    limiteErrosGlobais: number(pick(source, 'limiteErrosGlobais', 'LimiteErrosGlobais')),
    intervaloMinimoEntreRequisicoesSegundos: number(pick(source, 'intervaloMinimoEntreRequisicoesSegundos', 'IntervaloMinimoEntreRequisicoesSegundos')),
    ultimaRequisicao: pick(source, 'ultimaRequisicao', 'UltimaRequisicao', 'ultimaRequisicaoAgente', 'UltimaRequisicaoAgente') || null,
    proximaRequisicaoPermitida: pick(source, 'proximaRequisicaoPermitida', 'ProximaRequisicaoPermitida') || null,
    heartbeat: pick(source, 'heartbeat', 'Heartbeat', 'ultimoHeartbeat', 'UltimoHeartbeat', 'ultimaAtualizacao', 'UltimaAtualizacao') || now,
    ultimoEvento: text(pick(source, 'ultimoEvento', 'UltimoEvento'), null),
    categoriaUltimoErro: text(pick(source, 'categoriaUltimoErro', 'CategoriaUltimoErro', 'lastErrorCategory', 'LastErrorCategory'), null),
    ultimoErro: text(pick(source, 'ultimoErro', 'UltimoErro', 'lastError', 'LastError'), null),

    cifActual: text(pick(source, 'cifActual', 'cifAtual', 'CIFAtual', 'CIF_Atual'), null),
    ficheiroActual: text(pick(source, 'ficheiroActual', 'ficheiroAtual', 'FicheiroAtual', 'Ficheiro_Atual'), null),
    campoActual: text(pick(source, 'campoActual', 'campoAtual', 'CampoActual', 'CampoAtual', 'currentField', 'CurrentField'), null),

    pausado: Boolean(pick(source, 'pausado', 'Pausado', 'pausaSolicitada', 'PausaSolicitada')),
    paragemSeguraSolicitada: Boolean(pick(source, 'paragemSeguraSolicitada', 'ParagemSeguraSolicitada')),
    ultimoComandoLiveControl: text(pick(source, 'ultimoComandoLiveControl', 'UltimoComandoLiveControl'), null),
    alteradoPorLiveControl: text(pick(source, 'alteradoPorLiveControl', 'AlteradoPorLiveControl'), null),
    motivoUltimoComando: text(pick(source, 'motivoUltimoComando', 'MotivoUltimoComando'), null),
    dataUltimoComandoLiveControl: pick(source, 'dataUltimoComandoLiveControl', 'DataUltimoComandoLiveControl') || null,

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

    timeline: normalizeTimeline(pick(source, 'timeline', 'Timeline'), source),
    errosPorTipo: objectNumberMap(pick(source, 'errosPorTipo', 'ErrosPorTipo', 'errorsByType', 'ErrorsByType')),
    workers: normalizeWorkers(pick(source, 'workers', 'Workers')),

    rawPayload: payload,
    rawPayloadPreview: JSON.stringify(payload).slice(0, 12000),
    rawKeys: Object.keys(payload || {})
  };

  item.progressoPercentual = number(pick(source, 'progressoPercentual', 'ProgressoPercentual'), percent(cifsProcessados, cifsRecebidos));
  item.sucessoPercentual = number(pick(source, 'sucessoPercentual', 'SucessoPercentual'), percent(cifsSucesso, cifsProcessados));
  return item;
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
    return sendJson(res, 200, {
      ok: true,
      status: 'online',
      service: 'external-telemetry-dashboard',
      storageMode: 'memory-only',
      latestHeartbeat: store.latest?.heartbeat || null,
      latestReceivedAt: store.latest?.receivedAt || null,
      historyItems: store.history.length,
      commandItems: store.commands.length,
      telemetryAuthRequired: REQUIRE_TELEMETRY_KEY,
      time: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && (pathname === '/api/telemetry/latest' || pathname === '/api/latest')) {
    if (!store.latest) return sendJson(res, 404, { status: 'empty', message: 'No telemetry received yet.', storageMode: 'memory-only' });
    return sendJson(res, 200, store.latest);
  }

  if (req.method === 'GET' && (pathname === '/api/debug/latest' || pathname === '/api/raw/latest')) {
    if (!store.latest) return sendJson(res, 404, { status: 'empty', message: 'No telemetry received yet.', storageMode: 'memory-only' });
    return sendJson(res, 200, { ok: true, storageMode: 'memory-only', receivedAt: store.latest.receivedAt, rawPayload: store.latest.rawPayload, normalized: store.latest });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, { ok: true, storageMode: 'memory-only', latest: store.latest, historyCount: store.history.length, commands: store.commands.slice(-50) });
  }

  if (req.method === 'GET' && (pathname === '/api/telemetry/history' || pathname === '/api/history')) {
    const take = Math.min(number(requestUrl.searchParams.get('take') || requestUrl.searchParams.get('limit'), MAX_HISTORY), MAX_HISTORY);
    const items = store.history.slice(-take);
    if (pathname === '/api/history') return sendJson(res, 200, { ok: true, storageMode: 'memory-only', items: items.slice().reverse() });
    return sendJson(res, 200, items);
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
    if (store.latest) res.write(`data: ${JSON.stringify({ type: 'telemetry', latest: store.latest })}\n\n`);
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  if (req.method === 'POST' && ['/api/telemetry', '/telemetry', '/api/metrics', '/api/state'].includes(pathname)) {
    if (REQUIRE_TELEMETRY_KEY && !isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized telemetry write.' });
    return handleJson(req, res, (parsed) => {
      const item = normalizeTelemetry(parsed, req);
      store.latest = item;
      store.history.push(item);
      store.history = store.history.slice(-MAX_HISTORY);
      addLog('INF', `Telemetria recebida | Exec=${item.idExecucao || '-'} | Estado=${item.estadoFinal || '-'} | Progresso=${item.progressoPercentual || 0}%`);
      broadcast({ type: 'telemetry', latest: item });
      return sendJson(res, 202, { ok: true, storageMode: 'memory-only', idExecucao: item.idExecucao, receivedAt: item.receivedAt, shownInDashboard: true });
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
  console.log(`[INF] StorageMode=memory-only | POST /api/telemetry | AuthObrigatoria=${REQUIRE_TELEMETRY_KEY}`);
  console.log('[INF] Live Control: POST /api/commands | Senha via payload/header');
});
