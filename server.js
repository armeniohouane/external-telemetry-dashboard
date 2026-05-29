/**
 * server.js  –  Agente Clientes Irregulares · Dashboard Server
 *
 * Função: relay entre o agente C# (ExternalDashboardPushHostedService) e o
 * browser do dashboard.
 *
 * Fluxo:
 *   1. C# agent → POST /api/telemetry (ou /api/push, /api/agent/telemetry…)
 *      → servidor guarda estado em memória
 *   2. Browser   → GET /api/dashboard/snapshot|telemetry|events|history
 *      → servidor devolve estado guardado
 *   3. Browser   → POST /api/live-control/command
 *      → servidor coloca comando na fila
 *   4. C# agent  → GET /api/commands
 *      → servidor devolve fila de comandos pendentes
 *   5. C# agent  → POST /api/commands/:id/ack
 *      → servidor limpa o comando confirmado
 *   6. C# agent  → POST /api/history/sync  (histórico SQL)
 *      → servidor guarda histórico separado
 *
 * Variáveis de ambiente (.env ou Render Dashboard):
 *   PORT              Porta do servidor               (default: 3000)
 *   AGENT_API_KEY     Chave que o agente envia como   (default: sem validação)
 *                     X-Api-Key / Authorization Bearer
 *   COMMAND_QUEUE_TTL Minutos até um comando expirar  (default: 10)
 *   MAX_EVENTS        Máximo de eventos em memória    (default: 500)
 */

'use strict';

const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÃO
   ═══════════════════════════════════════════════════════════════════════════ */
const AGENT_API_KEY     = (process.env.AGENT_API_KEY || 'rpa-gemini-2026-chave-provisoria-de-teste').trim();
const COMMAND_QUEUE_TTL = parseInt(process.env.COMMAND_QUEUE_TTL || '10', 10) * 60 * 1000;
const MAX_EVENTS        = parseInt(process.env.MAX_EVENTS || '500', 10);

/* ── Dashboard Login/Auth ───────────────────────────────────────────────── */
const DASHBOARD_USERS = new Set(
  (process.env.DASHBOARD_USERS || 'X000000,X251682,X002336')
    .split(',')
    .map(u => u.trim().toUpperCase())
    .filter(Boolean)
);
const DASHBOARD_PASSWORD = (process.env.DASHBOARD_PASSWORD || 'Zeux').trim();
const DASHBOARD_SESSION_TTL = parseInt(process.env.DASHBOARD_SESSION_TTL || '10', 10) * 60 * 1000;
const dashboardSessions = new Map();

/* ═══════════════════════════════════════════════════════════════════════════
   ESTADO EM MEMÓRIA
   ═══════════════════════════════════════════════════════════════════════════ */
const store = {
  /* Último payload completo enviado pelo agente C# */
  payload: null,

  /* Histórico SQL sincronizado por POST /api/history/sync */
  sqlHistory: null,

  /* Fila de comandos pendentes para o agente ir buscar */
  commandQueue: [],

  /* IDs de comandos já confirmados (evita re-aplicação) */
  acknowledgedIds: new Set(),

  /* Métricas de push */
  pushCount:   0,
  lastPushAt:  null,
  lastPushIp:  null,
};

/* ── Defaults para quando ainda não chegou nenhum push ────────────────────── */
function emptySnapshot(runtime) {
  return {
    instanceName:         'Agente Clientes Irregulares',
    idExecucao:           '—',
    estadoSistema:        'Sem dados',
    modoActual:           '—',
    runtimeActual:        runtime || 'Web',
    ultimoHeartbeat:      '—',
    percentualConcluido:  0,
    heroMetrics:          [],
    heroBottom:           [],
    cardGroups:           [],
    qualityRows:          [],
    modelRows:            [],
    payload:              {},
    seriesUltimas3h:      { labels: [], processados: [], sucesso: [], naoEncontrado: [], invalidos: [], erros: [] },
    distribuicaoResultados: { sucesso: 0, naoEncontrado: 0, invalidos: 0, erros: 0 },
    erros:                { labels: [], values: [] },
  };
}

function emptyTelemetry() {
  return { groups: [] };
}

function emptyEvents() {
  return { idExecucao: '—', items: [] };
}

function emptyHistory() {
  return { cards: [], items: [], chart: { labels: [], cifsProcessados: [], taxaSucesso: [] } };
}

function emptyLiveControl() {
  return {
    modoOperacao:  { modo: 'Automático', respeitarJanela: true, permitirFtpForaDoOnline: false, offlineUsaApenasLocal: true, encerrarNaTroca: 'Após CIF Actual', janelaCustom: '18:00 - 06:00' },
    apiWorkers:    { numeroWorkers: 0, batchPorWorker: 400, permitirNovosClaims: true, encerrarAposCifActual: false },
    webWorker:     { activo: true, intervaloPromptSegundos: 20, timeoutRespostaSegundos: 180, maxErrosConsecutivos: 3 },
    staging:       { activo: true, cifsParaPreparar: 500, maxGbDisco: 20, maxFicheirosPorCif: 10, prioridade: 'Normal', substituirExistentes: false, validarFtpAntes: true },
    rateLimits:    { rpm: 13, rpd: 1400, tpm: 120000, intervaloMinimoSegundos: 5, tempoBackoffMinutos: 5, errosGlobaisPermitidos: 3 },
    workers:       [{ workerId: 'WEB_WORKER_01', runtime: 'Web', estado: 'Livre', cifActual: null, campoActual: null }],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MIDDLEWARES GLOBAIS
   ═══════════════════════════════════════════════════════════════════════════ */

/* CORS — permite que o agente C# envie de qualquer origem */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Api-Key, X-Telemetry-Key, X-Client, X-Instance-Name, X-Execution-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '10mb' }));

/* ── Middleware de autenticação para endpoints de push ────────────────────── *
 * Só activo se AGENT_API_KEY estiver definido.                               *
 * O agente envia a chave em vários headers; qualquer um válido é aceite.     *
 * ─────────────────────────────────────────────────────────────────────────── */
function requireAgentKey(req, res, next) {
  if (!AGENT_API_KEY) return next();   // sem chave configurada → aceitar tudo

  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const candidates = [
    req.headers['x-api-key'],
    req.headers['x-telemetry-key'],
    bearer,
  ].filter(Boolean);

  if (candidates.some(k => k === AGENT_API_KEY)) return next();

  console.warn(`[auth] Push rejeitado de ${req.ip} – chave inválida`);
  res.status(401).json({ error: 'Chave de API inválida' });
}


/* ── Dashboard Session helpers ─────────────────────────────────────────── */

/**
 * Extrai o token de sessão do header Authorization (Bearer <token>)
 * ou do query param ?token=<token>.
 */
function extractDashboardToken(req) {
  const authHeader = (req.headers['authorization'] || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return req.query.token || null;
}

/**
 * Devolve a sessão associada ao request, ou null se inválida/expirada.
 */
function getDashboardSession(req) {
  const token = extractDashboardToken(req);
  if (!token) return null;

  const session = dashboardSessions.get(token);
  if (!session) return null;

  // Verificar TTL
  if (Date.now() - session.createdAt > DASHBOARD_SESSION_TTL) {
    dashboardSessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Middleware: bloqueia o acesso se não houver sessão válida.
 */
function requireDashboardAuth(req, res, next) {
  if (!!getDashboardSession(req)) return next();
  res.status(401).json({ ok: false, authenticated: false, restricted: true, message: 'Autenticação necessária para consultar esta secção.' });
}

/** Limpa sessões expiradas periodicamente */
function purgeExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of dashboardSessions) {
    if (now - session.createdAt > DASHBOARD_SESSION_TTL) {
      dashboardSessions.delete(token);
    }
  }
}
setInterval(purgeExpiredSessions, 5 * 60 * 1000);

/* ── Logging resumido ─────────────────────────────────────────────────────── */
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
  }
  next();
});

/* ═══════════════════════════════════════════════════════════════════════════
   ENDPOINTS DE PUSH  (chamados pelo ExternalDashboardPushHostedService)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Recebe o payload completo (ExternalDashboardPayloadDto) e actualiza o store.
 * O C# tenta vários paths por ordem; todos apontam para o mesmo handler.
 */
function handleTelemetryPush(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Payload inválido' });
  }

  store.payload    = body;
  store.pushCount += 1;
  store.lastPushAt = new Date().toISOString();
  store.lastPushIp = req.ip;

  /* Se o payload trouxer histórico, guardamos também */
  if (body.history) store.sqlHistory = body.history;

  console.log(`[push] #${store.pushCount} recebido — instância: ${body.instanceName || '?'} | execução: ${body.idExecucao || '?'}`);

  res.json({
    ok: true,
    received: store.pushCount,
    timestamp: store.lastPushAt,
    pendingCommands: store.commandQueue.length,
    authenticated: hasDashboardAuth(req),
    publicView: !hasDashboardAuth(req),
  });
}

/* Todos os paths que o ExternalDashboardPushHostedService tenta por POST */
const pushPaths = [
  '/api/telemetry',
  '/api/agent/telemetry',
  '/api/agent/push',
  '/api/push',
];

pushPaths.forEach(p => app.post(p, requireAgentKey, handleTelemetryPush));

/* POST /api/dashboard/telemetry  – POST=push do agente; GET=leitura do browser */
app.post('/api/dashboard/telemetry', requireAgentKey, handleTelemetryPush);

/* Endpoint raiz (quando EndpointUrl aponta directamente para a origem) */
app.post('/', requireAgentKey, handleTelemetryPush);

/* ── Histórico SQL ──────────────────────────────────────────────────────── */
function handleHistorySync(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Payload inválido' });

  store.sqlHistory = body;
  console.log(`[history-sync] ${body.syncedAt || '?'} — ${(body.items || []).length} linhas`);
  res.json({ ok: true, received: (body.items || []).length });
}

['/api/history/sync', '/api/sql-history', '/api/history'].forEach(p =>
  app.post(p, requireAgentKey, handleHistorySync)
);

/* ═══════════════════════════════════════════════════════════════════════════
   ENDPOINTS DE COMANDO  (polling pelo C# + ACK)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/commands  (e aliases)
 * O agente faz polling aqui. Devolvemos os comandos pendentes que ainda
 * não foram confirmados. O agente usa o campo "id" para ACK posterior.
 */
function handleCommandPoll(req, res) {
  purgeStalCommands();

  const instanceName = req.query.instanceName || req.query.instance || '*';
  const idExecucao   = req.query.idExecucao   || '*';

  const pending = store.commandQueue.filter(cmd => {
    if (store.acknowledgedIds.has(cmd.id)) return false;
    /* Filtragem opcional por instância/execução */
    if (instanceName !== '*' && cmd.instanceName && cmd.instanceName !== instanceName) return false;
    return true;
  });

  console.log(`[commands] poll de ${instanceName}/${idExecucao} — ${pending.length} pendente(s)`);
  res.json(pending);
}

[
  '/api/commands',
  '/api/live-control/commands',
  '/api/agent/commands',
  '/api/control/commands',
].forEach(p => app.get(p, handleCommandPoll));

/**
 * POST /api/commands/:commandId/ack
 * O agente confirma que aplicou o comando.
 */
app.post('/api/commands/:commandId/ack', requireAgentKey, (req, res) => {
  const { commandId } = req.params;
  const body = req.body || {};

  store.acknowledgedIds.add(commandId);
  store.commandQueue = store.commandQueue.filter(c => c.id !== commandId);

  console.log(`[ack] comando ${commandId} confirmado — ${body.command || '?'} aplicado em ${body.appliedAt || '?'}`);
  res.json({ ok: true, commandId });
});



/* ═══════════════════════════════════════════════════════════════════════════
   ENDPOINTS DE LOGIN / LOGOUT (dashboard browser)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/auth/login
 * Body: { "user": "X251682" }
 * Apenas a matrícula é necessária para aceder ao dashboard.
 * A senha é usada apenas no Live Control (modal separado no frontend).
 */
app.post('/api/auth/login', (req, res) => {
  const { user } = req.body || {};

  if (!user) {
    return res.status(400).json({ ok: false, message: 'Campo "user" (matrícula) é obrigatório.' });
  }

  const normalizedUser = String(user).trim().toUpperCase();

  if (!DASHBOARD_USERS.has(normalizedUser)) {
    console.warn(`[auth] Login recusado – matrícula desconhecida: ${normalizedUser}`);
    return res.status(401).json({ ok: false, message: 'Matrícula não autorizada.' });
  }

  const token = crypto.randomUUID();
  dashboardSessions.set(token, { user: normalizedUser, createdAt: Date.now() });

  console.log(`[auth] Login OK — ${normalizedUser} (sessão: ${token.slice(0, 8)}…)`);

  res.json({
    ok: true,
    token,
    user: normalizedUser,
    expiresIn: DASHBOARD_SESSION_TTL,
  });
});

/**
 * POST /api/auth/logout
 * Token vem no header Authorization: Bearer <token>
 */
app.post('/api/auth/logout', (req, res) => {
  const token = extractDashboardToken(req);
  if (token && dashboardSessions.has(token)) {
    const session = dashboardSessions.get(token);
    dashboardSessions.delete(token);
    console.log(`[auth] Logout — ${session.user}`);
  }
  res.json({ ok: true, message: 'Sessão terminada.' });
});

/**
 * GET /api/auth/me
 * Devolve informação da sessão actual (ou 401).
 */
app.get('/api/auth/me', (req, res) => {
  const session = getDashboardSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, authenticated: false });
  }
  res.json({
    ok: true,
    authenticated: true,
    user: session.user,
    createdAt: new Date(session.createdAt).toISOString(),
    expiresAt: new Date(session.createdAt + DASHBOARD_SESSION_TTL).toISOString(),
  });
});

/* ── Public/minimal dashboard helpers ───────────────────────────────────── */
function hasDashboardAuth(req) {
  return !!getDashboardSession(req);
}

function minimalSnapshot(snapshot, runtime) {
  const snap = snapshot || emptySnapshot(runtime);
  const allowedHeroBottom = (snap.heroBottom || []).filter(row => {
    const label = String(row.label || '').toLowerCase();
    return !label.includes('cif') && !label.includes('campo');
  });

  return {
    instanceName: snap.instanceName || 'Agente Clientes Irregulares',
    idExecucao: snap.idExecucao || '—',
    estadoSistema: snap.estadoSistema || 'Sem dados',
    modoActual: snap.modoActual || '—',
    runtimeActual: snap.runtimeActual || runtime || 'Web',
    ultimoHeartbeat: snap.ultimoHeartbeat || '—',
    percentualConcluido: snap.percentualConcluido || 0,
    heroMetrics: snap.heroMetrics || [],
    heroBottom: allowedHeroBottom,
    cardGroups: [],
    qualityRows: [],
    modelRows: [],
    payload: {},
    seriesUltimas3h: snap.seriesUltimas3h || { labels: [], processados: [], sucesso: [], naoEncontrado: [], invalidos: [], erros: [] },
    distribuicaoResultados: snap.distribuicaoResultados || { sucesso: 0, naoEncontrado: 0, invalidos: 0, erros: 0 },
    erros: { labels: [], values: [] },
    publicView: true,
  };
}

function restrictedMessage() {
  return { ok: false, authenticated: false, restricted: true, message: 'Autenticação necessária para consultar esta secção.' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENDPOINTS DO DASHBOARD FRONTEND
   ═══════════════════════════════════════════════════════════════════════════ */

/* GET /api/dashboard/health */
app.get('/api/dashboard/health', (req, res) => {
  const p = store.payload;
  res.json({
    status:       p ? 'online' : 'sem dados',
    instanceName: p?.instanceName || '—',
    idExecucao:   p?.idExecucao   || '—',
    pushCount:    store.pushCount,
    lastPushAt:   store.lastPushAt || '—',
    serverTime:   new Date().toLocaleString('pt-PT'),
    pendingCommands: store.commandQueue.length,
  });
});

/* GET /api/dashboard/snapshot?runtime= */
app.get('/api/dashboard/snapshot', (req, res) => {
  const runtime = req.query.runtime || 'Web';
  const p = store.payload;
  const snap = p?.snapshot ? { ...p.snapshot, runtimeActual: p.snapshot.runtimeActual || runtime } : emptySnapshot(runtime);

  if (!hasDashboardAuth(req)) {
    return res.json(minimalSnapshot(snap, runtime));
  }

  res.json(snap);
});

/* GET /api/dashboard/telemetry */
app.get('/api/dashboard/telemetry', requireDashboardAuth, (req, res) => {
  const p = store.payload;
  res.json(p?.telemetry || emptyTelemetry());
});

/* GET /api/dashboard/events?take= */
app.get('/api/dashboard/events', requireDashboardAuth, (req, res) => {
  const take = parseInt(req.query.take || '100', 10);
  const p    = store.payload;

  if (!p?.events) return res.json(emptyEvents());

  const items = Array.isArray(p.events.items)
    ? p.events.items.slice(-take)
    : [];

  res.json({ ...p.events, items });
});

/* GET /api/dashboard/history */
app.get('/api/dashboard/history', requireDashboardAuth, (req, res) => {
  /* Preferência: histórico SQL sincronizado da tabela Worker.
     Fallback: histórico vindo no payload completo, se existir. */
  const history = store.sqlHistory || store.payload?.history;
  if (!history) return res.json(emptyHistory());

  /* Se vier como linhas raw da BD/tabela Worker, converter para o formato do frontend. */
  if (history.items && Array.isArray(history.items) && history.items[0]?.IdExecucao !== undefined) {
    return res.json(formatSqlHistory(history));
  }

  res.json(history);
});

/* GET /api/dashboard/export */
app.get('/api/dashboard/export', requireDashboardAuth, (req, res) => {
  const take           = parseInt(req.query.take || '100', 10);
  const includeHistory = req.query.includeHistory === 'true';
  const p              = store.payload;

  if (!p) return res.json({ ok: false, message: 'Sem dados disponíveis' });

  const events = p.events?.items ? { ...p.events, items: p.events.items.slice(-take) } : emptyEvents();

  res.json({
    instanceName: p.instanceName,
    idExecucao:   p.idExecucao,
    exportedAt:   new Date().toLocaleString('pt-PT'),
    pushCount:    store.pushCount,
    lastPushAt:   store.lastPushAt,
    health:       p.health,
    snapshot:     p.snapshot   || emptySnapshot('Web'),
    telemetry:    p.telemetry  || emptyTelemetry(),
    events,
    liveControl:  p.liveControl || emptyLiveControl(),
    history:      includeHistory ? (p.history || store.sqlHistory || emptyHistory()) : null,
  });
});

/* ── Live Control ─────────────────────────────────────────────────────────── */

/* GET /api/live-control/state */
app.get('/api/live-control/state', requireDashboardAuth, (req, res) => {
  const p = store.payload;
  res.json(p?.liveControl || emptyLiveControl());
});

/**
 * POST /api/live-control/command
 * Chamado pelo browser. Coloca o comando na fila para o agente ir buscar.
 * A autenticação com senha é feita no browser (app.js); aqui apenas
 * aceitamos o comando e colocamos na fila.
 */
app.post('/api/live-control/command', requireDashboardAuth, (req, res) => {
  const { command, payload } = req.body || {};

  if (!command || typeof command !== 'string') {
    return res.status(400).json({ ok: false, message: 'Campo "command" é obrigatório' });
  }

  purgeStalCommands();

  const id = crypto.randomUUID();
  const queued = {
    id,
    command,
    payload:    payload || {},
    queuedAt:   new Date().toISOString(),
    expiresAt:  new Date(Date.now() + COMMAND_QUEUE_TTL).toISOString(),
    instanceName: store.payload?.instanceName || '*',
  };

  store.commandQueue.push(queued);
  console.log(`[command] "${command}" adicionado à fila — id: ${id}`);

  res.json({
    ok:      true,
    id,
    message: `Comando "${command}" colocado na fila. Será aplicado na próxima poll do agente.`,
    pendingCommands: store.commandQueue.length,
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITÁRIOS INTERNOS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Remove comandos cujo TTL expirou */
function purgeStalCommands() {
  const now = Date.now();
  const before = store.commandQueue.length;
  store.commandQueue = store.commandQueue.filter(c => new Date(c.expiresAt).getTime() > now);
  const removed = before - store.commandQueue.length;
  if (removed > 0) console.log(`[queue] ${removed} comando(s) expirado(s) removidos`);
}

/** Converte histórico SQL raw (formato TabelaVarredura) para o formato do frontend */
function formatSqlHistory(history) {
  const items = (history.items || []).map(row => ({
    idExecucao:      row.IdExecucao || '—',
    data:            row.DataHoraInicio || '—',
    modo:            row.Modo || '—',
    runtime:         row.Runtime || '—',
    estado:          row.EstadoFinal || row.EstadoSistema || '—',
    cifsProcessados: row.CifsProcessados ?? 0,
    taxaSucesso:     row.TaxaSucesso != null ? `${Number(row.TaxaSucesso).toFixed(1)}%` : '—',
    erros:           row.CifsComErro ?? 0,
    duracao:         calcDuration(row.DataHoraInicio, row.DataHoraFim),
  }));

  const chart = {
    labels:          items.map(r => r.idExecucao.slice(-6)),
    cifsProcessados: items.map(r => r.cifsProcessados),
    taxaSucesso:     items.map(r => parseFloat(r.taxaSucesso) || 0),
  };

  return { cards: [], items, chart };
}

function calcDuration(start, end) {
  if (!start || !end) return '—';
  try {
    const diff = new Date(end) - new Date(start);
    if (isNaN(diff) || diff < 0) return '—';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  } catch { return '—'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FICHEIROS ESTÁTICOS  (o próprio dashboard)
   ═══════════════════════════════════════════════════════════════════════════ */
app.use(express.static(path.join(__dirname, 'public')));

/* SPA fallback — qualquer rota desconhecida devolve index.html */
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('Not found');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ARRANQUE
   ═══════════════════════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Agente Clientes Irregulares · Dashboard Server');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  API key:    ${AGENT_API_KEY ? '✓ configurada' : '— sem validação'}`);
  console.log(`  Command TTL: ${COMMAND_QUEUE_TTL / 60000} min`);
  console.log(`  Max events:  ${MAX_EVENTS}`);
  console.log('═══════════════════════════════════════════════════');
});
