const AppConfig = {
  apiBase: "",
  isLocal: false,
  autoRefreshMs: 5000
};

const State = {
  activePage: "realtime",
  selectedRuntime: "web",
  viewRuntime: localStorage.getItem("ciViewRuntime") || "web",
  latest: null,
  latestReceivedAt: null,
  history: [],
  commandAudit: [],
  charts: {}
};

const colors = {
  text: "#111111",
  muted: "#6b7280",
  grid: "#ececef",
  pink: "#e6007e",
  black: "#111111",
  green: "#128a48",
  amber: "#b7791f",
  red: "#c81e1e",
  blue: "#1d4ed8",
  grey: "#9ca3af"
};

const PROGRESS_WINDOW_MS = 60 * 60 * 1000;
const ACTIVE_TELEMETRY_MAX_AGE_MS = 45 * 1000;

function $(id) { return document.getElementById(id); }
function setText(id, value) { const el = $(id); if (el) el.textContent = value ?? "--"; }
function url(path) { return `${AppConfig.apiBase}${path}`; }
function pick(obj, ...keys) { for (const k of keys) { if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k]; } return undefined; }
function n(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function formatNumber(value) { return new Intl.NumberFormat("pt-PT").format(n(value)); }
function formatInteger(value) { return new Intl.NumberFormat("pt-PT").format(Math.round(n(value))); }
function formatDecimal(value, maxDecimals = 2) { return new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals }).format(n(value)); }
function formatPercent(value) { return `${Math.round(n(value))}%`; }
function formatDateTime(value) { if (!value) return "--"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "--"; return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
function formatTime(value) { if (!value) return "--:--:--"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "--:--:--"; return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
function formatDuration(seconds) { const v = n(seconds); if (v <= 0) return "0s"; if (v < 60) return `${Math.round(v)}s`; return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`; }
function ratio(part, total) { return !n(total) ? 0 : (n(part) / n(total)) * 100; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function isDateFresh(value, maxAgeMs = ACTIVE_TELEMETRY_MAX_AGE_MS) { if (!value) return false; const d = new Date(value); return !Number.isNaN(d.getTime()) && Date.now() - d.getTime() < maxAgeMs; }
function isTelemetryActive() { return Boolean(State.latest) && isDateFresh(State.latestReceivedAt, ACTIVE_TELEMETRY_MAX_AGE_MS); }
function isWithinProgressWindow(value) { if (!value) return false; const d = new Date(value); if (Number.isNaN(d.getTime())) return false; const age = Date.now() - d.getTime(); return age >= -60 * 1000 && age <= PROGRESS_WINDOW_MS; }
function normalizeRuntime(value) { const runtime = String(value || "web").toLowerCase(); if (runtime.includes("api")) return "api"; return "web"; }
function runtimeDisplayName(value) { return normalizeRuntime(value) === "api" ? "API" : "Web"; }
function getField(data, camel, pascal, fallback = 0) { return pick(data, camel, pascal) ?? fallback; }

function field(data, ...keys) { return pick(data, ...keys); }
function metric(data, ...keys) { return n(field(data, ...keys)); }
function executionId(data) { return field(data, "idExecucao", "Id_Execucao", "id_execucao", "IdExecucao") ?? "--"; }
function estadoFinal(data) { return field(data, "estadoFinal", "Estado_Final", "EstadoFinal") ?? "--"; }
function runtimeValue(data) { return field(data, "runtimeActual", "Runtime_Actual", "RuntimeActual") ?? "web"; }
function modeloValue(data) { return field(data, "modeloSeleccionado", "modeloSelecionado", "modeloActual", "Modelo_Seleccionado", "Modelo_Selecionado", "ModeloActual") ?? "--"; }
function historyDate(data) { return field(data, "dataHoraOrigem", "heartbeat", "Data_Hora_Fim", "Data_Hora_Inicio", "Criado_Em", "DataHoraFim", "DataHoraInicio"); }
function historyMs(data) { const d = new Date(historyDate(data)); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); }
function isLast24h(data) { const ms = historyMs(data); return !ms || (Date.now() - ms <= 24 * 60 * 60 * 1000); }
function pruneClientHistory() { State.history = (State.history || []).filter(isLast24h).slice(-20000); }
function appendHistoryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const incoming = asRawHistoryItem(item);
  const key = [executionId(incoming), historyDate(incoming), metric(incoming, "cifsProcessados", "CIFs_Processados")].join("|");
  const last = State.history[State.history.length - 1];
  const lastKey = last ? [executionId(last), historyDate(last), metric(last, "cifsProcessados", "CIFs_Processados")].join("|") : "";
  if (key !== lastKey) State.history.push(incoming);
  pruneClientHistory();
}
function uniqueExecutionItems(items) {
  const byId = new Map();
  const withoutId = [];
  for (const item of (items || []).filter(isLast24h)) {
    const id = executionId(item);
    if (!id || id === "--") { withoutId.push(item); continue; }
    const current = byId.get(String(id));
    if (!current || historyMs(item) >= historyMs(current)) byId.set(String(id), item);
  }
  return [...byId.values(), ...withoutId].sort((a, b) => historyMs(b) - historyMs(a));
}

function emptyLatest() {
  return {
    idExecucao: "--",
    estadoFinal: "A aguardar telemetria real",
    runtimeActual: "web",
    runtimeSolicitado: State.selectedRuntime || "web",
    runtimeModo: "dev",
    cifsRecebidos: 0,
    cifsProcessados: 0,
    cifsSucesso: 0,
    cifsNaoEncontrado: 0,
    cifsInvalidos: 0,
    cifsComErro: 0,
    ficheirosRecebidos: 0,
    ficheirosAvaliados: 0,
    ficheirosFtp550: 0,
    tempoBackoffTotalMinutos: 0,
    uploads: 0,
    timeoutsAgente: 0,
    errosDirectLine: 0,
    apiWorkersActivos: 0,
    apiWorkersTotal: 0,
    apiWorkersBackoff: 0,
    apiBatchSize: 0,
    apiRpmActual: 0,
    apiRpmLimit: 0,
    apiRpdHoje: 0,
    apiRpdLimit: 0,
    apiTpmActual: 0,
    apiTpmLimit: 0,
    apiTpdHoje: 0,
    apiTpdLimit: 0,
    apiRequestsHoje: 0,
    apiInputTokens: 0,
    apiOutputTokens: 0,
    apiCustoEstimadoUsd: 0,
    apiQuotaRestantePercent: 0,
    workers: [],
    normalizacoesSolicitadas: 0,
    normalizacoesComSucesso: 0,
    tempoMedioPorCif: 0,
    tempoMedioRespostaAgente: 0,
    modeloActual: "--",
    modeloSeleccionado: "--",
    fallbackCount: 0,
    errosGlobaisConsecutivos: 0,
    cifActual: "Sanitizado",
    campoActual: "--",
    ficheiroActual: "Sanitizado",
    ultimaRequisicao: null,
    proximaRequisicaoPermitida: null,
    heartbeat: null,
    timeline: [],
    errosPorTipo: {}
  };
}

function asRawTelemetry(raw) {
  // Sem normalização no frontend: usa o payload exactamente como foi devolvido pela API.
  // O objecto não é enriquecido, não recebe aliases e não é convertido para defaults.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

function asRawHistoryItem(x) {
  return asRawTelemetry(x);
}

async function apiGetResponse(path) {
  const response = await fetch(url(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { response, body: await response.json() };
}

async function apiGet(path) {
  return (await apiGetResponse(path)).body;
}

async function apiPost(path, payload) {
  const r = await fetch(url(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(body.error || `HTTP ${r.status}`);
    error.status = r.status;
    throw error;
  }
  return body;
}

async function refreshLatest() {
  try {
    const result = await apiGetResponse("/api/telemetry/latest");
    State.latest = asRawTelemetry(result.body);
    State.latestReceivedAt = result.response.headers.get("X-Latest-Received-At") || State.latestReceivedAt;
    appendHistoryItem(State.latest);
    setText("dataSourceSide", isTelemetryActive() ? "REAL" : "STALE");
  } catch (e) {
    if (!State.latest || String(e?.message || "").includes("404")) {
      State.latest = null;
      State.latestReceivedAt = null;
    }
    setText("dataSourceSide", "SEM DADOS");
  }
  renderRealtime();
}

async function refreshHistory() {
  try {
    const data = await apiGet("/api/telemetry/history?take=25000");
    const items = Array.isArray(data) ? data : (data.items || []);
    State.history = items.map(asRawHistoryItem).filter(isLast24h);
    pruneClientHistory();
  } catch (e) {
    State.history = [];
  }
  renderHistory();
}

async function refreshCommands() {
  try {
    const data = await apiGet("/api/commands");
    State.commandAudit = Array.isArray(data) ? data : (data.items || []);
  } catch (e) {
    State.commandAudit = [];
  }
  renderCommandAudit();
}

function chart(id, options) {
  const el = $(id);
  if (!window.ApexCharts || !el) return;
  if (!State.charts[id]) { State.charts[id] = new ApexCharts(el, options); State.charts[id].render(); }
  else State.charts[id].updateOptions(options, true, true);
}

function baseChartOptions() {
  return {
    chart: { toolbar: { show: false }, fontFamily: "Inter, Segoe UI, Arial" },
    dataLabels: { enabled: false },
    grid: { borderColor: colors.grid },
    xaxis: { labels: { style: { colors: colors.muted } } },
    yaxis: { labels: { style: { colors: colors.muted }, formatter: value => formatDecimal(value, 2) } },
    legend: { labels: { colors: colors.text } },
    stroke: { curve: "smooth", width: 3 },
    tooltip: { theme: "light", y: { formatter: value => formatDecimal(value, 2) } }
  };
}

function effectiveRuntime(data = State.latest || emptyLatest()) {
  return normalizeRuntime(State.viewRuntime || data.runtimeActual || "web");
}

function applyRuntimeView(data = State.latest || emptyLatest()) {
  const viewRuntime = effectiveRuntime(data);
  document.querySelectorAll(".runtime-web-panel").forEach(el => el.classList.toggle("active", viewRuntime === "web"));
  document.querySelectorAll(".runtime-api-panel").forEach(el => el.classList.toggle("active", viewRuntime === "api"));
  document.querySelectorAll(".runtime-api-control").forEach(el => el.style.display = State.selectedRuntime === "api" ? "" : "none");
  document.querySelectorAll(".runtime-web-control").forEach(el => el.style.display = State.selectedRuntime === "web" ? "" : "none");
  setText("runtimeViewLabel", runtimeDisplayName(viewRuntime));
  setText("runtimeActualLabel", runtimeDisplayName(data.runtimeActual || viewRuntime));
  setText("controlRuntimeActual", runtimeDisplayName(data.runtimeActual || viewRuntime));
  setText("controlRuntimeRequested", runtimeDisplayName(data.runtimeSolicitado || State.selectedRuntime));
  setText("controlRuntime", runtimeDisplayName(viewRuntime));
  if ($("runtimeViewSelector")) $("runtimeViewSelector").value = viewRuntime;
  if ($("paramRuntime")) $("paramRuntime").value = State.selectedRuntime;
}

function renderRealtime() {
  const d = State.latest || emptyLatest();
  applyRuntimeView(d);
  const progress = ratio(d.cifsProcessados, d.cifsRecebidos);
  const successRate = ratio(d.cifsSucesso, d.cifsProcessados);
  const isFresh = isTelemetryActive();
  setText("agentHealthText", isFresh ? "Activo" : (State.latest ? "Sem telemetria recente" : "Sem telemetria"));
  if ($("agentHealthDot")) $("agentHealthDot").className = `dot ${isFresh ? "" : "danger"}`;
  if ($("heartbeatDot")) $("heartbeatDot").className = `dot ${isFresh ? "" : "danger"}`;
  setText("executionStatus", d.estadoFinal || "--");
  setText("currentExecutionId", `Execução #${d.idExecucao || "--"}`);
  setText("lastHeartbeatSide", formatTime(d.heartbeat));
  if ($("executionProgressBar")) $("executionProgressBar").style.width = `${Math.min(100, Math.max(0, progress))}%`;
  setText("mReceived", formatNumber(d.cifsRecebidos));
  setText("mFilesReceived", formatNumber(d.ficheirosRecebidos || d.ficheirosAvaliados));
  setText("mProcessed", formatNumber(d.cifsProcessados));
  setText("mPending", formatNumber(Math.max(0, n(d.cifsRecebidos) - n(d.cifsProcessados))));
  setText("mProgressPercent", formatPercent(progress));
  setText("currentCif", d.cifActual || "Sanitizado");
  setText("currentField", d.campoActual || "--");
  setText("currentFilesProcessed", formatNumber(d.uploads));
  setText("currentFile", "Oculto no dashboard");
  setText("kpiProcessed", formatNumber(d.cifsProcessados));
  setText("kpiProcessedMeta", `${formatPercent(progress)} da fila`);
  setText("kpiSuccess", formatNumber(d.cifsSucesso));
  setText("kpiSuccessRate", formatPercent(successRate));
  setText("kpiNotFound", formatNumber(d.cifsNaoEncontrado));
  setText("kpiCifErrors", formatNumber(d.cifsComErro));
  setText("kpiUploads", formatNumber(effectiveRuntime(d) === "api" ? (d.apiRequestsHoje || d.uploads) : d.uploads));
  setText("kpiTransportLabel", effectiveRuntime(d) === "api" ? "Requests API" : "Uploads Feitos");
  setText("kpiTransportMeta", effectiveRuntime(d) === "api" ? "Chamadas ao modelo por API" : "Ficheiros anexados ao agente");
  setText("kpiModel", d.modeloSeleccionado || d.modeloActual || "--");
  setText("kpiModelMeta", `${formatNumber(d.fallbackCount || 0)} fallback(s)`);
  setText("kpiBackoffTotal", `${formatNumber(d.tempoBackoffTotalMinutos)}m`);
  setText("kpiFtp550", formatNumber(d.ficheirosFtp550));
  setText("kpiModelErrors", formatNumber(n(d.timeoutsAgente) + n(d.errosDirectLine)));
  setText("kpiTimeouts", formatNumber(d.timeoutsAgente));
  setText("kpiNormalizations", formatNumber(d.normalizacoesSolicitadas));
  setText("kpiNormalizationsMeta", `${formatNumber(d.normalizacoesComSucesso)} com sucesso`);
  setText("kpiAvgTime", formatDuration(d.tempoMedioPorCif));
  setText("kpiAvgTimeMeta", `Resposta agente: ${formatDuration(d.tempoMedioRespostaAgente)}`);
  setText("apiWorkersActive", formatNumber(d.apiWorkersActivos));
  setText("apiWorkersMeta", `${formatNumber(d.apiWorkersTotal)} workers configurados`);
  setText("apiWorkersBackoff", formatNumber(d.apiWorkersBackoff));
  setText("apiRpmActual", formatNumber(d.apiRpmActual));
  setText("apiRpmMeta", `Limite: ${formatNumber(d.apiRpmLimit)}/min`);
  setText("apiRpdToday", formatNumber(d.apiRpdHoje));
  setText("apiRpdMeta", `Limite diário: ${formatNumber(d.apiRpdLimit)}`);
  setText("apiTpmActual", formatNumber(d.apiTpmActual));
  setText("apiTpmMeta", `Limite: ${formatNumber(d.apiTpmLimit)}/min`);
  setText("apiTpdToday", formatNumber(d.apiTpdHoje));
  setText("apiTpdMeta", `Limite diário: ${formatNumber(d.apiTpdLimit)}`);
  setText("apiBatchSize", formatNumber(d.apiBatchSize));
  setText("apiRequestsToday", formatNumber(d.apiRequestsHoje));
  setText("apiInputTokens", formatNumber(d.apiInputTokens));
  setText("apiOutputTokens", formatNumber(d.apiOutputTokens));
  setText("apiEstimatedCost", `$${n(d.apiCustoEstimadoUsd).toFixed(2)}`);
  setText("apiQuotaMeta", `${formatPercent(d.apiQuotaRestantePercent)} quota restante`);
  setText("qualitySuccess", formatPercent(successRate));
  setText("qualityInvalid", formatPercent(ratio(d.cifsInvalidos, d.cifsProcessados)));
  setText("qualityError", formatPercent(ratio(d.cifsComErro, d.cifsProcessados)));
  setText("qualityFtp", formatPercent(ratio(d.ficheirosFtp550, d.ficheirosAvaliados || d.ficheirosRecebidos)));
  setText("qualityNormalization", formatPercent(ratio(d.normalizacoesComSucesso, d.normalizacoesSolicitadas)));
  setText("modelCurrent", d.modeloActual || "--");
  setText("modelFallbacks", formatNumber(d.fallbackCount));
  setText("modelGlobalErrors", formatNumber(d.errosGlobaisConsecutivos));
  setText("modelLastRequest", formatDateTime(d.ultimaRequisicao));
  setText("modelNextRequest", formatDateTime(d.proximaRequisicaoPermitida));
  setText("controlExecution", d.idExecucao || "--");
  setText("controlState", d.estadoFinal || "--");
  setText("controlModel", d.modeloSeleccionado || d.modeloActual || "--");
  const rawEl = $("rawPayloadPreview");
  if (rawEl) {
    rawEl.textContent = State.latest ? JSON.stringify(State.latest, null, 2) : "Sem payload recebido.";
  }
  setText("rawPayloadStatus", d.dataHoraOrigem ? `Origem ${formatDateTime(d.dataHoraOrigem)}` : (State.latest ? "Payload recebido" : "A aguardar"));
  renderWorkers(d.workers || []);
  renderCharts(d);
}

function buildTimeline(d) {
  const historyPoints = (State.history || [])
    .filter(x => isWithinProgressWindow(historyDate(x)))
    .filter(x => metric(x, "cifsProcessados", "CIFs_Processados") > 0 || metric(x, "cifsRecebidos", "CIFs_Recebidos") > 0)
    .sort((a, b) => historyMs(a) - historyMs(b))
    .slice(-300)
    .map(x => ({
      label: formatTime(historyDate(x)),
      timestamp: historyDate(x),
      processed: metric(x, "cifsProcessados", "CIFs_Processados"),
      success: metric(x, "cifsSucesso", "CIFs_Sucesso"),
      notFound: metric(x, "cifsNaoEncontrado", "CIFs_Nao_Encontrado"),
      errors: metric(x, "cifsComErro", "CIFs_Com_Erro"),
      progress: ratio(metric(x, "cifsProcessados", "CIFs_Processados"), metric(x, "cifsRecebidos", "CIFs_Recebidos"))
    }));
  if (historyPoints.length) return historyPoints;

  if (Array.isArray(d.timeline) && d.timeline.length) {
    const payloadPoints = d.timeline
      .map(x => ({
        label: x.label || formatTime(x.timestamp || x.data || x.dataHoraOrigem),
        timestamp: x.timestamp || x.data || x.dataHoraOrigem || null,
        processed: n(x.processed ?? x.cifsProcessados),
        success: n(x.success ?? x.cifsSucesso),
        notFound: n(x.notFound ?? x.cifsNaoEncontrado),
        errors: n(x.errors ?? x.cifsComErro),
        progress: n(x.progress ?? ratio(x.cifsProcessados, x.cifsRecebidos))
      }))
      .filter(x => x.timestamp && isWithinProgressWindow(x.timestamp))
      .slice(-300);
    if (payloadPoints.length) return payloadPoints;
  }

  const currentPointTime = d.heartbeat || State.latestReceivedAt;
  if (isWithinProgressWindow(currentPointTime)) {
    return [{ label: formatTime(currentPointTime), timestamp: currentPointTime, processed: n(d.cifsProcessados), success: n(d.cifsSucesso), notFound: n(d.cifsNaoEncontrado), errors: n(d.cifsComErro), progress: ratio(d.cifsProcessados, d.cifsRecebidos) }];
  }
  return [{ label: "--", processed: 0, success: 0, notFound: 0, errors: 0, progress: 0 }];
}


function renderCharts(d) {
  const timeline = buildTimeline(d);
  const labels = timeline.map(x => x.label || formatTime(x.timestamp || x.data));
  const progressSeries = timeline.map(x => Math.round(n(x.progress)));
  setText("progressChartLastPoint", labels[labels.length - 1] ? `Últimos 60 min · ${labels[labels.length - 1]}` : "Últimos 60 min");

  chart("chartProgressDynamic", {
    ...baseChartOptions(),
    chart: { ...baseChartOptions().chart, type: "area", height: 190, foreColor: "#fff" },
    colors: [colors.pink],
    xaxis: { categories: labels, labels: { style: { colors: "#fff" } } },
    yaxis: { min: 0, max: 100, labels: { style: { colors: "#fff" }, formatter: value => formatInteger(value) } },
    series: [{ name: "Progresso", data: progressSeries }],
    fill: { opacity: 0.25 },
    grid: { borderColor: "rgba(255,255,255,.12)" },
    tooltip: {
      theme: "light",
      custom: ({ dataPointIndex }) => {
        const point = timeline[dataPointIndex] || {};
        const label = labels[dataPointIndex] || "--";
        return `<div class="chart-tooltip"><div class="chart-tooltip-title">${escapeHtml(label)}</div><div class="chart-tooltip-row"><span>Progresso</span><strong>${formatDecimal(point.progress, 2)}%</strong></div><div class="chart-tooltip-row"><span>CIFs processados</span><strong>${formatInteger(point.processed)}</strong></div></div>`;
      }
    }
  });

  chart("chartRealtimeLine", {
    ...baseChartOptions(),
    chart: { ...baseChartOptions().chart, type: "line", height: 310 },
    colors: [colors.blue, colors.green, colors.amber, colors.red],
    xaxis: { categories: labels },
    yaxis: { labels: { style: { colors: colors.muted }, formatter: value => formatInteger(value) } },
    tooltip: { theme: "light", y: { formatter: value => formatInteger(value) } },
    series: [
      { name: "Processados", data: timeline.map(x => Math.round(n(x.processed))) },
      { name: "Sucesso", data: timeline.map(x => Math.round(n(x.success))) },
      { name: "Não Encontrado", data: timeline.map(x => Math.round(n(x.notFound))) },
      { name: "Erros", data: timeline.map(x => Math.round(n(x.errors))) }
    ]
  });

  const resultSeries = [n(d.cifsSucesso), n(d.cifsNaoEncontrado), n(d.cifsInvalidos), n(d.cifsComErro)].map(x => Math.round(x));
  const resultTotal = resultSeries.reduce((a, x) => a + x, 0);
  chart("chartResultDonut", {
    chart: { type: "donut", height: 270, fontFamily: "Inter, Segoe UI, Arial" },
    labels: ["Sucesso", "Não Encontrado", "Inválido", "Erro"],
    colors: [colors.green, colors.amber, colors.blue, colors.red],
    series: resultSeries,
    legend: { position: "bottom" },
    dataLabels: { enabled: false },
    tooltip: { theme: "light", y: { formatter: value => formatInteger(value) } },
    plotOptions: {
      pie: {
        donut: {
          size: "68%",
          labels: {
            show: true,
            name: { show: true, color: colors.muted, fontSize: "12px", fontWeight: 800 },
            value: { show: true, color: colors.text, fontSize: "26px", fontWeight: 930, formatter: value => formatInteger(value) },
            total: { show: true, showAlways: true, label: "Total", color: colors.muted, fontSize: "12px", fontWeight: 850, formatter: () => formatInteger(resultTotal) }
          }
        }
      }
    },
    noData: { text: "Sem dados" }
  });

  const errorEntries = Object.entries(d.errosPorTipo || {});
  const errorLabels = errorEntries.length ? errorEntries.map(([k]) => k) : ["Sem erros"];
  const errorValues = errorEntries.length ? errorEntries.map(([, v]) => Math.round(n(v))) : [0];
  chart("chartErrorTypes", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "bar", height: 270 }, plotOptions: { bar: { horizontal: true, borderRadius: 6 } }, colors: [colors.red], xaxis: { categories: errorLabels }, yaxis: { labels: { style: { colors: colors.muted }, formatter: value => formatInteger(value) } }, tooltip: { theme: "light", y: { formatter: value => formatInteger(value) } }, series: [{ name: "Ocorrências", data: errorValues }] });
}


function renderWorkers(workers) {
  const tbody = $("workersTableBody");
  if (!tbody) return;
  tbody.innerHTML = workers.map(w => `<tr><td>${escapeHtml(w.id || w.worker || "--")}</td><td>${escapeHtml(w.estado || "--")}</td><td>${escapeHtml(w.processando || "--")}</td><td>${formatNumber(w.filaLocal)}</td><td>${escapeHtml(w.modelo || "--")}</td><td>${formatDateTime(w.ultimoHeartbeat)}</td><td><button class="button warning" data-command="PauseWorker" data-worker="${escapeHtml(w.id || "")}">Pausar</button></td></tr>`).join("") || `<tr><td colspan="7">Sem workers registados para este runtime.</td></tr>`;
}

function renderHistory() {
  pruneClientHistory();
  const rawItems = State.history || [];
  const items = uniqueExecutionItems(rawItems);
  const processed = items.reduce((a, x) => a + metric(x, "cifsProcessados", "CIFs_Processados"), 0);
  const success = items.reduce((a, x) => a + metric(x, "cifsSucesso", "CIFs_Sucesso"), 0);
  const ftp = items.reduce((a, x) => a + metric(x, "ficheirosFtp550", "Ficheiros_FTP_550"), 0);
  const avg = items.length ? items.reduce((a, x) => a + metric(x, "tempoMedioPorCif", "Tempo_Medio_Por_CIF"), 0) / items.length : 0;
  setText("histExecutions", formatNumber(items.length));
  setText("histProcessed", formatNumber(processed));
  setText("histSuccessRate", formatPercent(ratio(success, processed)));
  setText("histFtp550", formatNumber(ftp));
  setText("histAvgTime", formatDuration(avg));
  const tbody = $("historyTableBody");
  if (tbody) {
    tbody.innerHTML = items.length
      ? items.map(x => `<tr><td>${escapeHtml(executionId(x))}</td><td>${formatDateTime(historyDate(x))}</td><td>${escapeHtml(estadoFinal(x))}</td><td>${runtimeDisplayName(runtimeValue(x))}</td><td>${escapeHtml(modeloValue(x))}</td><td>${formatNumber(metric(x, "cifsProcessados", "CIFs_Processados"))}</td><td>${formatNumber(metric(x, "cifsSucesso", "CIFs_Sucesso"))}</td><td>${formatNumber(metric(x, "cifsInvalidos", "CIFs_Invalidos"))}</td><td>${formatNumber(metric(x, "cifsComErro", "CIFs_Com_Erro"))}</td><td>${formatNumber(metric(x, "ficheirosFtp550", "Ficheiros_FTP_550"))}</td><td>${formatDuration(metric(x, "tempoMedioPorCif", "Tempo_Medio_Por_CIF"))}</td></tr>`).join("")
      : `<tr><td colspan="11">Sem histórico real recebido nas últimas 24 horas.</td></tr>`;
  }
  const executionLabels = items.length ? items.slice().reverse().map(x => String(executionId(x)).slice(-8)) : ["--"];
  const executionChartItems = items.length ? items.slice().reverse() : [emptyLatest()];
  chart("chartDailyKpis", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "bar", height: 310 }, colors: [colors.blue, colors.green], xaxis: { categories: executionLabels }, series: [{ name: "Processados", data: executionChartItems.map(x => metric(x, "cifsProcessados", "CIFs_Processados")) }, { name: "Sucesso", data: executionChartItems.map(x => metric(x, "cifsSucesso", "CIFs_Sucesso")) }] });

  const timeline = buildTimeline(State.latest || emptyLatest());
  const timelineLabels = timeline.map(x => x.label || formatTime(x.timestamp));
  chart("chartPeriodKpis", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "line", height: 310 }, colors: [colors.green, colors.red, colors.amber], xaxis: { categories: timelineLabels }, series: [{ name: "Sucesso %", data: timeline.map(x => Math.round(ratio(x.success, x.processed))) }, { name: "Erro %", data: timeline.map(x => Math.round(ratio(x.errors, x.processed))) }, { name: "Progresso %", data: timeline.map(x => Math.round(n(x.progress))) }] });
}

function renderCommandAudit() {
  const items = State.commandAudit || [];
  const last = items[0] || items[items.length - 1];
  setText("controlLastCommand", last?.command || last?.tipo || "--");
  setText("controlChangedBy", last?.requestedBy || last?.solicitadoPor || "--");
  const tbody = $("commandAuditBody");
  if (!tbody) return;
  tbody.innerHTML = items.map(x => `<tr><td>${formatDateTime(x.createdAt || x.dataHora || x.timestamp)}</td><td>${escapeHtml(x.command || x.tipo || "--")}</td><td>${escapeHtml(x.status || x.estado || "Pendente")}</td><td>${escapeHtml(x.requestedBy || x.solicitadoPor || "Dashboard")}</td><td>${escapeHtml(x.reason || x.motivo || "--")}</td></tr>`).join("") || `<tr><td colspan="5">Sem comandos registados.</td></tr>`;
}

function collectParameters() {
  return {
    intervalSeconds: $("paramInterval")?.value,
    maxGlobalErrors: $("paramGlobalErrors")?.value,
    runtime: $("paramRuntime")?.value || "web"
  };
}

async function sendCommand(command, extra = {}) {
  const controlPassword = window.prompt("Senha do Live Control:");
  if (controlPassword === null) return;
  const payload = {
    command,
    requestedBy: "Dashboard",
    reason: $("changeReason")?.value || "",
    runtime: State.selectedRuntime,
    parameters: collectParameters(),
    controlPassword,
    ...extra
  };
  try {
    await apiPost("/api/commands", payload);
    await refreshCommands();
    alert("Comando registado com sucesso.");
  } catch (e) {
    if (e.status === 401 || e.status === 403) alert("Senha inválida para o Live Control.");
    else alert("Não foi possível registar o comando. Verifique a API do dashboard.");
  }
}

function bindEvents() {
  document.querySelectorAll("[data-local-only]").forEach(x => x.style.display = AppConfig.isLocal ? "" : "none");
  document.querySelectorAll(".nav button").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = $(`page-${btn.dataset.page}`);
    if (page) page.classList.add("active");
    State.activePage = btn.dataset.page;
    if (State.activePage === "history") refreshHistory();
    if (State.activePage === "control") refreshCommands();
  }));
  $("refreshNowBtn")?.addEventListener("click", () => { refreshLatest(); refreshHistory(); refreshCommands(); });
  $("runtimeViewSelector")?.addEventListener("change", e => { State.viewRuntime = normalizeRuntime(e.target.value); localStorage.setItem("ciViewRuntime", State.viewRuntime); renderRealtime(); });
  $("paramRuntime")?.addEventListener("change", e => { State.selectedRuntime = normalizeRuntime(e.target.value); localStorage.setItem("ciSelectedRuntime", State.selectedRuntime); applyRuntimeView(State.latest || emptyLatest()); });
  $("applyRuntimeBtn")?.addEventListener("click", () => sendCommand("ApplyRuntimeSelection", { runtimeApplyMode: $("paramRuntimeApply")?.value || "nextExecution" }));
  $("saveParamsBtn")?.addEventListener("click", () => sendCommand("UpdateRuntimeParameters"));
  $("resetParamsBtn")?.addEventListener("click", () => { if ($("changeReason")) $("changeReason").value = ""; });
  document.body.addEventListener("click", e => { const btn = e.target.closest("[data-command]"); if (btn) sendCommand(btn.dataset.command, { worker: btn.dataset.worker || null }); });
  $("applyHistoryFilterBtn")?.addEventListener("click", refreshHistory);
}

async function setupLogs() {
  function addLog(item) {
    if (!$("logs")) return;
    const div = document.createElement("div");
    const level = item.level || item.Level || "INF";
    div.className = `log-line log-${level}`;
    div.textContent = `[${formatDateTime(item.timestamp || item.Timestamp)}] [${level}] ${item.message || item.Message || ""}`;
    $("logs").appendChild(div);
    $("logs").scrollTop = $("logs").scrollHeight;
  }

  try {
    if ($("logs")) (await apiGet("/api/logs?take=120")).forEach(addLog);
  } catch {}

  try {
    const events = new EventSource(url("/api/events"));
    events.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "telemetry" && message.latest) {
        State.latest = asRawTelemetry(message.latest);
        State.latestReceivedAt = message.receivedAt || new Date().toISOString();
        appendHistoryItem(State.latest);
        setText("dataSourceSide", isTelemetryActive() ? "LIVE" : "STALE");
        renderRealtime();
        if (State.activePage === "history") renderHistory();
        return;
      }
      if (message.type === "db-history") {
        refreshHistory();
        return;
      }
      if (message.type === "command") {
        refreshCommands();
        return;
      }
      addLog(message);
    };
    events.onerror = () => setText("dataSourceSide", "POLLING");
  } catch {}
}

bindEvents();
refreshLatest();
refreshHistory();
refreshCommands();
setupLogs();
setInterval(refreshLatest, AppConfig.autoRefreshMs);
setInterval(refreshHistory, Math.max(AppConfig.autoRefreshMs * 3, 15000));
