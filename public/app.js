const AppConfig = {
  apiBase: "",
  isLocal: false,
  autoRefreshMs: 10000
};

const State = {
  activePage: "realtime",
  selectedRuntime: "web",
  viewRuntime: localStorage.getItem("ciViewRuntime") || "web",
  latest: null,
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

function $(id) { return document.getElementById(id); }
function setText(id, value) { const el = $(id); if (el) el.textContent = value ?? "--"; }
function url(path) { return `${AppConfig.apiBase}${path}`; }
function pick(obj, ...keys) { for (const k of keys) { if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k]; } return undefined; }
function n(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function formatNumber(value) { return new Intl.NumberFormat("pt-PT").format(n(value)); }
function formatPercent(value) { return `${Math.round(n(value))}%`; }
function formatDateTime(value) { if (!value) return "--"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "--"; return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
function formatTime(value) { if (!value) return "--:--:--"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "--:--:--"; return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
function formatDuration(seconds) { const v = n(seconds); if (v <= 0) return "0s"; if (v < 60) return `${Math.round(v)}s`; return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`; }
function ratio(part, total) { return !n(total) ? 0 : (n(part) / n(total)) * 100; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function isHeartbeatFresh(value) { if (!value) return false; const d = new Date(value); return !Number.isNaN(d.getTime()) && Date.now() - d.getTime() < 45000; }
function normalizeRuntime(value) { const runtime = String(value || "web").toLowerCase(); if (runtime.includes("api")) return "api"; return "web"; }
function runtimeDisplayName(value) { return normalizeRuntime(value) === "api" ? "API" : "Web"; }
function getField(data, camel, pascal, fallback = 0) { return pick(data, camel, pascal) ?? fallback; }

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

function normalizeLatest(raw) {
  const data = raw && raw.data ? raw.data : (raw || {});
  const latest = { ...emptyLatest(), ...data };
  latest.idExecucao = pick(data, "idExecucao", "IdExecucao", "Id_Execucao") || latest.idExecucao;
  latest.estadoFinal = pick(data, "estadoFinal", "EstadoFinal", "estadoAtual", "EstadoAtual") || latest.estadoFinal;
  latest.runtimeActual = normalizeRuntime(pick(data, "runtimeActual", "RuntimeActual", "runtime") || latest.runtimeActual);
  latest.runtimeSolicitado = normalizeRuntime(pick(data, "runtimeSolicitado", "RuntimeSolicitado") || latest.runtimeSolicitado);
  latest.cifsRecebidos = getField(data, "cifsRecebidos", "CIFsRecebidos", latest.cifsRecebidos);
  latest.cifsProcessados = getField(data, "cifsProcessados", "CIFsProcessados", latest.cifsProcessados);
  latest.cifsSucesso = getField(data, "cifsSucesso", "CIFsSucesso", latest.cifsSucesso);
  latest.cifsNaoEncontrado = getField(data, "cifsNaoEncontrado", "CIFsNaoEncontrado", latest.cifsNaoEncontrado);
  latest.cifsInvalidos = getField(data, "cifsInvalidos", "CIFsInvalidos", latest.cifsInvalidos);
  latest.cifsComErro = getField(data, "cifsComErro", "CIFsComErro", latest.cifsComErro);
  latest.ficheirosRecebidos = getField(data, "ficheirosRecebidos", "FicheirosRecebidos", latest.ficheirosRecebidos);
  latest.ficheirosAvaliados = getField(data, "ficheirosAvaliados", "FicheirosAvaliados", latest.ficheirosAvaliados);
  latest.ficheirosFtp550 = getField(data, "ficheirosFtp550", "FicheirosFtp550", latest.ficheirosFtp550);
  latest.uploads = getField(data, "uploads", "Uploads", latest.uploads);
  latest.timeoutsAgente = getField(data, "timeoutsAgente", "TimeoutsAgente", latest.timeoutsAgente);
  latest.normalizacoesSolicitadas = getField(data, "normalizacoesSolicitadas", "NormalizacoesSolicitadas", latest.normalizacoesSolicitadas);
  latest.normalizacoesComSucesso = getField(data, "normalizacoesComSucesso", "NormalizacoesComSucesso", latest.normalizacoesComSucesso);
  latest.tempoMedioPorCif = pick(data, "tempoMedioPorCif", "tempoMedioPorCIF", "TempoMedioPorCIF") ?? latest.tempoMedioPorCif;
  latest.tempoMedioRespostaAgente = pick(data, "tempoMedioRespostaAgente", "TempoMedioRespostaAgente") ?? latest.tempoMedioRespostaAgente;
  latest.modeloActual = pick(data, "modeloActual", "ModeloActual", "modeloAlvo", "ModeloAlvo", "modelo") || latest.modeloActual;
  latest.modeloSeleccionado = pick(data, "modeloSeleccionado", "modeloSelecionado", "ModeloSelecionado") || latest.modeloSeleccionado;
  latest.cifActual = pick(data, "cifActual", "cifAtual", "CIFAtual") || latest.cifActual;
  latest.campoActual = pick(data, "campoActual", "campoAtual", "CampoAtual") || latest.campoActual;
  latest.ficheiroActual = pick(data, "ficheiroActual", "ficheiroAtual", "FicheiroAtual") || latest.ficheiroActual;
  latest.errosGlobaisConsecutivos = getField(data, "errosGlobaisConsecutivos", "ErrosConsecutivosGlobais", latest.errosGlobaisConsecutivos);
  latest.tempoBackoffTotalMinutos = getField(data, "tempoBackoffTotalMinutos", "TempoBackoffTotalMinutos", getField(data, "backoffGlobalMinutos", "BackoffGlobalMinutos", latest.tempoBackoffTotalMinutos));
  latest.ultimaRequisicao = pick(data, "ultimaRequisicao", "ultimaRequisicaoAgente", "UltimaRequisicaoAgente") || latest.ultimaRequisicao;
  latest.proximaRequisicaoPermitida = pick(data, "proximaRequisicaoPermitida", "ProximaRequisicaoPermitida") || latest.proximaRequisicaoPermitida;
  latest.heartbeat = pick(data, "heartbeat", "ultimoHeartbeat", "ultimaAtualizacao", "UltimaAtualizacao") || latest.heartbeat;
  latest.errosPorTipo = pick(data, "errosPorTipo", "ErrosPorTipo", "errorsByType") || latest.errosPorTipo || {};
  latest.timeline = Array.isArray(data.timeline) ? data.timeline : (Array.isArray(latest.timeline) ? latest.timeline : []);
  latest.workers = Array.isArray(data.workers) ? data.workers : [];
  return latest;
}

function normalizeHistoryItem(x) {
  const item = normalizeLatest(x);
  item.data = pick(x, "data", "Data", "receivedAt", "heartbeat", "ultimaAtualizacao", "UltimaAtualizacao") || item.heartbeat;
  return item;
}

async function apiGet(path) {
  const r = await fetch(url(path), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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
    State.latest = normalizeLatest(await apiGet("/api/telemetry/latest"));
    setText("dataSourceSide", "REAL");
  } catch (e) {
    State.latest = State.latest || emptyLatest();
    setText("dataSourceSide", "SEM DADOS");
  }
  renderRealtime();
}

async function refreshHistory() {
  try {
    const data = await apiGet("/api/telemetry/history");
    const items = Array.isArray(data) ? data : (data.items || []);
    State.history = items.map(normalizeHistoryItem).reverse();
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
  return { chart: { toolbar: { show: false }, fontFamily: "Inter, Segoe UI, Arial" }, dataLabels: { enabled: false }, grid: { borderColor: colors.grid }, xaxis: { labels: { style: { colors: colors.muted } } }, yaxis: { labels: { style: { colors: colors.muted } } }, legend: { labels: { colors: colors.text } }, stroke: { curve: "smooth", width: 3 } };
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
  const isFresh = isHeartbeatFresh(d.heartbeat);
  setText("agentHealthText", isFresh ? "Activo" : "Sem heartbeat");
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
  setText("currentFile", d.ficheiroActual || "Sanitizado");
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
  renderWorkers(d.workers || []);
  renderCharts(d);
}

function buildTimeline(d) {
  if (Array.isArray(d.timeline) && d.timeline.length) return d.timeline.slice(-12);
  if (d.heartbeat || n(d.cifsProcessados) > 0) {
    return [{ label: formatTime(d.heartbeat || new Date()), timestamp: d.heartbeat || new Date().toISOString(), processed: n(d.cifsProcessados), success: n(d.cifsSucesso), notFound: n(d.cifsNaoEncontrado), errors: n(d.cifsComErro), progress: ratio(d.cifsProcessados, d.cifsRecebidos) }];
  }
  return [{ label: "--", processed: 0, success: 0, notFound: 0, errors: 0, progress: 0 }];
}

function renderCharts(d) {
  const timeline = buildTimeline(d);
  const labels = timeline.map(x => x.label || formatTime(x.timestamp || x.data));
  setText("progressChartLastPoint", labels[labels.length - 1] || "--");
  chart("chartProgressDynamic", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "area", height: 190, foreColor: "#fff" }, colors: [colors.pink], xaxis: { categories: labels, labels: { style: { colors: "#fff" } } }, yaxis: { max: 100, labels: { style: { colors: "#fff" } } }, series: [{ name: "Progresso", data: timeline.map(x => n(x.progress)) }], fill: { opacity: 0.25 }, grid: { borderColor: "rgba(255,255,255,.12)" } });
  chart("chartRealtimeLine", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "line", height: 310 }, colors: [colors.blue, colors.green, colors.amber, colors.red], xaxis: { categories: labels }, series: [ { name: "Processados", data: timeline.map(x => n(x.processed)) }, { name: "Sucesso", data: timeline.map(x => n(x.success)) }, { name: "Não Encontrado", data: timeline.map(x => n(x.notFound)) }, { name: "Erros", data: timeline.map(x => n(x.errors)) } ] });
  chart("chartResultDonut", { chart: { type: "donut", height: 270, fontFamily: "Inter, Segoe UI, Arial" }, labels: ["Sucesso", "Não Encontrado", "Inválido", "Erro"], colors: [colors.green, colors.amber, colors.blue, colors.red], series: [n(d.cifsSucesso), n(d.cifsNaoEncontrado), n(d.cifsInvalidos), n(d.cifsComErro)], legend: { position: "bottom" }, dataLabels: { enabled: false }, noData: { text: "Sem dados" } });
  const errorEntries = Object.entries(d.errosPorTipo || {});
  const errorLabels = errorEntries.length ? errorEntries.map(([k]) => k) : ["Sem erros"];
  const errorValues = errorEntries.length ? errorEntries.map(([, v]) => n(v)) : [0];
  chart("chartErrorTypes", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "bar", height: 270 }, plotOptions: { bar: { horizontal: true, borderRadius: 6 } }, colors: [colors.red], xaxis: { categories: errorLabels }, series: [{ name: "Ocorrências", data: errorValues }] });
}

function renderWorkers(workers) {
  const tbody = $("workersTableBody");
  if (!tbody) return;
  tbody.innerHTML = workers.map(w => `<tr><td>${escapeHtml(w.id || w.worker || "--")}</td><td>${escapeHtml(w.estado || "--")}</td><td>${escapeHtml(w.processando || "--")}</td><td>${formatNumber(w.filaLocal)}</td><td>${escapeHtml(w.modelo || "--")}</td><td>${formatDateTime(w.ultimoHeartbeat)}</td><td><button class="button warning" data-command="PauseWorker" data-worker="${escapeHtml(w.id || "")}">Pausar</button></td></tr>`).join("") || `<tr><td colspan="7">Sem workers registados para este runtime.</td></tr>`;
}

function renderHistory() {
  const items = State.history;
  const processed = items.reduce((a, x) => a + n(x.cifsProcessados), 0);
  const success = items.reduce((a, x) => a + n(x.cifsSucesso), 0);
  const ftp = items.reduce((a, x) => a + n(x.ficheirosFtp550), 0);
  const avg = items.length ? items.reduce((a, x) => a + n(x.tempoMedioPorCif), 0) / items.length : 0;
  setText("histExecutions", formatNumber(items.length));
  setText("histProcessed", formatNumber(processed));
  setText("histSuccessRate", formatPercent(ratio(success, processed)));
  setText("histFtp550", formatNumber(ftp));
  setText("histAvgTime", formatDuration(avg));
  const tbody = $("historyTableBody");
  if (tbody) {
    tbody.innerHTML = items.length
      ? items.map(x => `<tr><td>${escapeHtml(x.idExecucao || "--")}</td><td>${formatDateTime(x.data || x.heartbeat)}</td><td>${escapeHtml(x.estadoFinal || "--")}</td><td>${runtimeDisplayName(x.runtimeActual)}</td><td>${escapeHtml(x.modeloSeleccionado || x.modeloActual || "--")}</td><td>${formatNumber(x.cifsProcessados)}</td><td>${formatNumber(x.cifsSucesso)}</td><td>${formatNumber(x.cifsInvalidos)}</td><td>${formatNumber(x.cifsComErro)}</td><td>${formatNumber(x.ficheirosFtp550)}</td><td>${formatDuration(x.tempoMedioPorCif)}</td></tr>`).join("")
      : `<tr><td colspan="11">Sem histórico real recebido.</td></tr>`;
  }
  const labels = items.length ? items.map(x => String(x.idExecucao || "--").slice(-8)) : ["--"];
  const chartItems = items.length ? items : [emptyLatest()];
  chart("chartDailyKpis", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "bar", height: 310 }, colors: [colors.blue, colors.green], xaxis: { categories: labels }, series: [{ name: "Processados", data: chartItems.map(x => n(x.cifsProcessados)) }, { name: "Sucesso", data: chartItems.map(x => n(x.cifsSucesso)) }] });
  chart("chartPeriodKpis", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "line", height: 310 }, colors: [colors.green, colors.red, colors.amber], xaxis: { categories: labels }, series: [{ name: "Sucesso %", data: chartItems.map(x => Math.round(ratio(x.cifsSucesso, x.cifsProcessados))) }, { name: "Erro %", data: chartItems.map(x => Math.round(ratio(x.cifsComErro, x.cifsProcessados))) }, { name: "FTP 550 / Ficheiros %", data: chartItems.map(x => Math.round(ratio(x.ficheirosFtp550, x.ficheirosAvaliados || x.ficheirosRecebidos))) }] });
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
  $("paramRuntime")?.addEventListener("change", e => { State.selectedRuntime = "web"; localStorage.setItem("ciSelectedRuntime", State.selectedRuntime); applyRuntimeView(State.latest || emptyLatest()); });
  $("applyRuntimeBtn")?.addEventListener("click", () => sendCommand("ApplyRuntimeSelection", { runtimeApplyMode: $("paramRuntimeApply")?.value || "nextExecution" }));
  $("saveParamsBtn")?.addEventListener("click", () => sendCommand("UpdateRuntimeParameters"));
  $("resetParamsBtn")?.addEventListener("click", () => { if ($("changeReason")) $("changeReason").value = ""; });
  document.body.addEventListener("click", e => { const btn = e.target.closest("[data-command]"); if (btn) sendCommand(btn.dataset.command, { worker: btn.dataset.worker || null }); });
  $("applyHistoryFilterBtn")?.addEventListener("click", refreshHistory);
}

async function setupLogs() {
  if (!AppConfig.isLocal || !$("logs")) return;
  function addLog(item) {
    const div = document.createElement("div");
    const level = item.level || item.Level || "INF";
    div.className = `log-line log-${level}`;
    div.textContent = `[${formatDateTime(item.timestamp || item.Timestamp)}] [${level}] ${item.message || item.Message || ""}`;
    $("logs").appendChild(div);
    $("logs").scrollTop = $("logs").scrollHeight;
  }
  try { (await apiGet("/api/logs?take=120")).forEach(addLog); } catch {}
  try { const events = new EventSource(url("/api/events")); events.onmessage = (event) => addLog(JSON.parse(event.data)); } catch {}
}

bindEvents();
refreshLatest();
refreshHistory();
refreshCommands();
setupLogs();
setInterval(refreshLatest, AppConfig.autoRefreshMs);
