'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const TELEMETRY_KEY = process.env.TELEMETRY_KEY || '';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 256);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 500);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'telemetry.jsonl');

if (!TELEMETRY_KEY || TELEMETRY_KEY.length < 16) {
  console.warn('[WARN] TELEMETRY_KEY não definido ou muito curto. Defina uma chave forte antes de expor publicamente.');
}

fs.mkdirSync(DATA_DIR, { recursive: true });

let latestTelemetry = null;
let history = [];

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function loadHistoryFromDisk() {
  if (!fs.existsSync(HISTORY_FILE)) return;
  const text = fs.readFileSync(HISTORY_FILE, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean).slice(-MAX_HISTORY);
  history = lines.map(safeJsonParse).filter(Boolean);
  latestTelemetry = history.length ? history[history.length - 1] : null;
}

function appendHistory(item) {
  history.push(item);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  fs.appendFile(HISTORY_FILE, JSON.stringify(item) + '\n', err => {
    if (err) console.error('[ERR] Falha ao gravar histórico:', err.message);
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

function timingSafeEqualText(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function validateTelemetry(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Payload deve ser um objecto JSON.';
  }

    const dangerousFields = ['cif', 'cliente', 'nomeCliente', 'caminho', 'filePath', 'ficheiro', 'fileName', 'prompt', 'rawResponse'];
  const lowerKeys = Object.keys(payload).map(k => k.toLowerCase());
  for (const field of dangerousFields) {
    if (lowerKeys.includes(field.toLowerCase())) {
      return `Campo sensível não permitido no dashboard externo: ${field}`;
    }
  }

  return null;
}

function sanitizePayload(payload) {
    const metrics = payload.metrics || payload.Metrics || {};

    const recentLogsRaw =
        payload.recentLogs ||
        payload.RecentLogs ||
        payload.logs ||
        payload.Logs ||
        [];

    const recentLogs = Array.isArray(recentLogsRaw)
        ? recentLogsRaw.slice(-200).map(item => {
            if (typeof item === 'string') {
                return {
                    timestamp: null,
                    level: 'INF',
                    message: item
                };
            }

            return {
                sequence: item.sequence ?? item.Sequence ?? null,
                timestamp: item.timestamp ?? item.Timestamp ?? null,
                level: item.level ?? item.Level ?? 'INF',
                sourceContext: item.sourceContext ?? item.SourceContext ?? null,
                message: item.message ?? item.Message ?? '',
                exception: item.exception ?? item.Exception ?? null
            };
        })
        : [];

    const telemetry = {
        receivedAt: new Date().toISOString(),

        instanceName:
            payload.instanceName ??
            payload.InstanceName ??
            null,

        idExecucao:
            payload.idExecucao ??
            payload.IdExecucao ??
            payload.currentExecutionId ??
            payload.CurrentExecutionId ??
            null,

        estado:
            payload.estado ??
            payload.Estado ??
            payload.status ??
            payload.Status ??
            null,

        campoAtual:
            payload.campoAtual ??
            payload.CampoAtual ??
            payload.currentCampo ??
            payload.CurrentCampo ??
            null,

        ficheiroAtualIndice:
            payload.ficheiroAtualIndice ??
            payload.FicheiroAtualIndice ??
            payload.currentCifFileIndex ??
            payload.CurrentCifFileIndex ??
            null,

        ficheiroAtualTotal:
            payload.ficheiroAtualTotal ??
            payload.FicheiroAtualTotal ??
            payload.currentCifTotalFiles ??
            payload.CurrentCifTotalFiles ??
            null,

        cifsRecebidos:
            payload.cifsRecebidos ??
            payload.CifsRecebidos ??
            metrics.cifsRecebidos ??
            metrics.CifsRecebidos ??
            0,

        cifsProcessados:
            payload.cifsProcessados ??
            payload.CifsProcessados ??
            metrics.cifsProcessados ??
            metrics.CifsProcessados ??
            0,

        cifsSucesso:
            payload.cifsSucesso ??
            payload.CifsSucesso ??
            metrics.cifsSucesso ??
            metrics.CifsSucesso ??
            0,

        cifsNaoEncontrado:
            payload.cifsNaoEncontrado ??
            payload.CifsNaoEncontrado ??
            metrics.cifsNaoEncontrado ??
            metrics.CifsNaoEncontrado ??
            0,

        cifsInvalidos:
            payload.cifsInvalidos ??
            payload.CifsInvalidos ??
            metrics.cifsInvalidos ??
            metrics.CifsInvalidos ??
            0,

        cifsComErro:
            payload.cifsComErro ??
            payload.CifsComErro ??
            metrics.cifsComErro ??
            metrics.CifsComErro ??
            0,

        ficheirosNaFila:
            payload.ficheirosNaFila ??
            payload.FicheirosNaFila ??
            metrics.ficheirosNaFila ??
            metrics.FicheirosNaFila ??
            0,

        ficheirosAvaliados:
            payload.ficheirosAvaliados ??
            payload.FicheirosAvaliados ??
            metrics.ficheirosAvaliados ??
            metrics.FicheirosAvaliados ??
            0,

        ficheirosFtp550:
            payload.ficheirosFtp550 ??
            payload.FicheirosFtp550 ??
            metrics.ficheirosFtp550 ??
            metrics.FicheirosFtp550 ??
            0,

        requestsGemini:
            payload.requestsGemini ??
            payload.RequestsGemini ??
            metrics.requestsGemini ??
            metrics.RequestsGemini ??
            0,

        timeoutsAgente:
            payload.timeoutsAgente ??
            payload.TimeoutsAgente ??
            metrics.timeoutsAgente ??
            metrics.TimeoutsAgente ??
            0,

        errosApi:
            payload.errosApi ??
            payload.ErrosApi ??
            metrics.errosApi ??
            metrics.ErrosApi ??
            0,

        progressoPercentual:
            payload.progressoPercentual ??
            payload.ProgressoPercentual ??
            metrics.progressoPercentual ??
            metrics.ProgressoPercentual ??
            0,

        sucessoPercentual:
            payload.sucessoPercentual ??
            payload.SucessoPercentual ??
            metrics.sucessoPercentual ??
            metrics.SucessoPercentual ??
            0,

        ultimoEvento:
            payload.ultimoEvento ??
            payload.UltimoEvento ??
            payload.status ??
            payload.Status ??
            null,

        categoriaUltimoErro:
            payload.categoriaUltimoErro ??
            payload.CategoriaUltimoErro ??
            payload.lastErrorCategory ??
            payload.LastErrorCategory ??
            null,

        dataHoraOrigem:
            payload.dataHoraOrigem ??
            payload.DataHoraOrigem ??
            payload.sentAt ??
            payload.SentAt ??
            null,

        recentLogs
    };

    return telemetry;
}
loadHistoryFromDisk();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return sendFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    return sendFile(res, path.join(__dirname, 'public', 'app.js'), 'application/javascript; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/style.css') {
    return sendFile(res, path.join(__dirname, 'public', 'style.css'), 'text/css; charset=utf-8');
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, {
      ok: true,
      latest: latestTelemetry,
      historyCount: history.length
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), MAX_HISTORY);
    return sendJson(res, 200, {
      ok: true,
      items: history.slice(-limit).reverse()
    });
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'external-telemetry-dashboard', time: new Date().toISOString() });
  }

  if (req.method === 'POST' && url.pathname === '/api/telemetry') {
    const key = req.headers['x-telemetry-key'];
    if (!timingSafeEqualText(String(key || ''), TELEMETRY_KEY)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }

    let body;
    try {
      body = await readRequestBody(req);
    } catch (err) {
      return sendJson(res, 413, { ok: false, error: err.message });
    }

    const parsed = safeJsonParse(body);
    const validationError = validateTelemetry(parsed);
    if (validationError) {
      return sendJson(res, 400, { ok: false, error: validationError });
    }

    const telemetry = sanitizePayload(parsed);
    latestTelemetry = telemetry;
    appendHistory(telemetry);

    console.log(`[INF] Telemetria recebida | ${telemetry.instanceName || '-'} | Estado=${telemetry.estado || '-'} | Progresso=${telemetry.progressoPercentual || 0}%`);
    return sendJson(res, 200, { ok: true, receivedAt: telemetry.receivedAt });
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[INF] Dashboard externo iniciado em http://0.0.0.0:${PORT}`);
  console.log('[INF] Endpoint de telemetria: POST /api/telemetry');
});
