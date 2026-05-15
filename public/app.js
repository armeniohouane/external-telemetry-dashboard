const AppConfig = {
      apiBase: "",
      isLocal: false,
      autoRefreshMs: 10000,
      useDemoWhenApiFails: true
    };

    const State = { activePage: "realtime", selectedRuntime: localStorage.getItem("ciSelectedRuntime") || "web", viewRuntime: localStorage.getItem("ciViewRuntime") || "web", latest: null, history: [], commandAudit: [], charts: {} };

    const Demo = {
      latest: {
        idExecucao: "DEV-20260515-001", estadoFinal: "Em Execução", runtimeActual: "web", runtimeSolicitado: "web", runtimeModo: "manual",
        cifsRecebidos: 420, cifsProcessados: 248, cifsSucesso: 176, cifsNaoEncontrado: 31, cifsInvalidos: 19, cifsComErro: 22,
        ficheirosRecebidos: 1046, ficheirosAvaliados: 982, ficheirosFtp550: 77, tempoBackoffTotalMinutos: 38, uploads: 711, timeoutsAgente: 8, errosDirectLine: 4,
        apiWorkersActivos: 3, apiWorkersTotal: 4, apiWorkersBackoff: 1, apiBatchSize: 400, apiRpmActual: 7, apiRpmLimit: 13, apiRpdHoje: 118, apiRpdLimit: 1400,
        apiTpmActual: 28650, apiTpmLimit: 100000, apiTpdHoje: 603119, apiTpdLimit: 1000000, apiRequestsHoje: 118, apiInputTokens: 603119, apiOutputTokens: 13842, apiCustoEstimadoUsd: 1.42, apiQuotaRestantePercent: 84,
        workers: [
          { id: "Worker-01", estado: "Activo", processando: "Data De Emissão", filaLocal: 18, modelo: "Gemma 4 31B IT", ultimoHeartbeat: new Date(Date.now() - 8000).toISOString() },
          { id: "Worker-02", estado: "Activo", processando: "Morada", filaLocal: 14, modelo: "Gemma 4 31B IT", ultimoHeartbeat: new Date(Date.now() - 12000).toISOString() },
          { id: "Worker-03", estado: "Backoff", processando: "Aguardar janela RPM", filaLocal: 21, modelo: "Gemini Flash", ultimoHeartbeat: new Date(Date.now() - 26000).toISOString() }
        ],
        normalizacoesSolicitadas: 36, normalizacoesComSucesso: 29, tempoMedioPorCif: 126, tempoMedioRespostaAgente: 48,
        modeloActual: "Claude / Opus", modeloSeleccionado: "Claude / Opus", fallbackCount: 0, errosGlobaisConsecutivos: 1,
        cifActual: "Sanitizado", campoActual: "Data De Emissão", ficheiroActual: "Sanitizado",
        ultimaRequisicao: new Date(Date.now() - 47000).toISOString(), proximaRequisicaoPermitida: new Date(Date.now() + 13000).toISOString(), heartbeat: new Date().toISOString(),
        timeline: [
          { label: "10:00", processed: 22, success: 16, notFound: 2, errors: 1, progress: 5 },
          { label: "10:30", processed: 55, success: 41, notFound: 7, errors: 4, progress: 13 },
          { label: "11:00", processed: 89, success: 66, notFound: 11, errors: 7, progress: 21 },
          { label: "11:30", processed: 132, success: 94, notFound: 19, errors: 12, progress: 31 },
          { label: "12:00", processed: 180, success: 129, notFound: 24, errors: 17, progress: 43 },
          { label: "12:30", processed: 248, success: 176, notFound: 31, errors: 22, progress: 59 }
        ],
        errosPorTipo: { "FTP 550": 77, "Timeout Agente": 8, "Erro Upload": 4, "Resposta Inválida": 6, "Erro Persistência": 1 }
      },
      history: []
    };
    Demo.history = [0,1,2,3,4,5].map((x) => ({ ...Demo.latest, idExecucao: `DEV-202605${15-x}-00${x+1}`, data: new Date(Date.now() - x*86400000).toISOString(), cifsProcessados: 248 + x*24, cifsSucesso: 176 + x*20, cifsInvalidos: 19 + x*2, cifsComErro: 22 + x, ficheirosFtp550: 77 + x*4, tempoMedioPorCif: 126 + x*3, estadoFinal: x === 0 ? "Em Execução" : "Concluído" }));

    const colors = { text: "#111111", muted: "#6b7280", grid: "#ececef", pink: "#e6007e", black: "#111111", green: "#128a48", amber: "#b7791f", red: "#c81e1e", blue: "#1d4ed8", grey: "#9ca3af" };

    function $(id) { return document.getElementById(id); }
    function url(path) { return `${AppConfig.apiBase}${path}`; }
    function pick(obj, ...keys) { for (const k of keys) { if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k]; } return undefined; }
    function n(value) { return Number(value || 0); }
    function formatNumber(value) { return new Intl.NumberFormat("pt-PT").format(n(value)); }
    function formatPercent(value) { return `${Math.round(n(value))}%`; }
    function formatDateTime(value) { if (!value) return "--"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "--"; return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
    function formatTime(value) { if (!value) return "--:--:--"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "--:--:--"; return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d); }
    function formatDuration(seconds) { const v = n(seconds); if (v < 60) return `${Math.round(v)}s`; return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`; }
    function ratio(part, total) { return !n(total) ? 0 : (n(part) / n(total)) * 100; }
    function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
    function isHeartbeatFresh(value) { return value && Date.now() - new Date(value).getTime() < 45000; }
    function normalizeRuntime(value) { const runtime = String(value || "web").toLowerCase(); if (runtime.includes("api")) return "api"; if (runtime.includes("auto")) return "auto"; return "web"; }
    function runtimeDisplayName(value) { const runtime = normalizeRuntime(value); if (runtime === "api") return "API"; if (runtime === "auto") return "Auto"; return "Web"; }
    function getField(data, camel, pascal, fallback = 0) { return pick(data, camel, pascal) ?? fallback; }

    function normalizeLatest(raw) {
      const data = raw && raw.data ? raw.data : (raw || {});
      const latest = { ...Demo.latest, ...data };
      latest.idExecucao = pick(data, "idExecucao", "IdExecucao") || latest.idExecucao;
      latest.estadoFinal = pick(data, "estadoFinal", "EstadoFinal", "estadoAtual", "EstadoAtual") || latest.estadoFinal;
      latest.runtimeActual = pick(data, "runtimeActual", "RuntimeActual", "runtime") || latest.runtimeActual;
      latest.runtimeSolicitado = pick(data, "runtimeSolicitado", "RuntimeSolicitado") || State.selectedRuntime;
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
      latest.modeloActual = pick(data, "modeloActual", "ModeloActual", "modeloAlvo", "ModeloAlvo") || latest.modeloActual;
      latest.modeloSeleccionado = pick(data, "modeloSeleccionado", "modeloSelecionado", "ModeloSelecionado") || latest.modeloSeleccionado;
      latest.cifActual = pick(data, "cifActual", "cifAtual", "CIFAtual") || latest.cifActual;
      latest.campoActual = pick(data, "campoActual", "campoAtual", "CampoAtual") || latest.campoActual;
      latest.ficheiroActual = pick(data, "ficheiroActual", "ficheiroAtual", "FicheiroAtual") || latest.ficheiroActual;
      latest.errosGlobaisConsecutivos = getField(data, "errosGlobaisConsecutivos", "ErrosConsecutivosGlobais", latest.errosGlobaisConsecutivos);
      latest.tempoBackoffTotalMinutos = getField(data, "tempoBackoffTotalMinutos", "TempoBackoffTotalMinutos", getField(data, "backoffGlobalMinutos", "BackoffGlobalMinutos", latest.tempoBackoffTotalMinutos));
      latest.ultimaRequisicao = pick(data, "ultimaRequisicao", "ultimaRequisicaoAgente", "UltimaRequisicaoAgente") || latest.ultimaRequisicao;
      latest.proximaRequisicaoPermitida = pick(data, "proximaRequisicaoPermitida", "ProximaRequisicaoPermitida") || latest.proximaRequisicaoPermitida;
      latest.heartbeat = pick(data, "heartbeat", "ultimoHeartbeat", "ultimaAtualizacao", "UltimaAtualizacao") || new Date().toISOString();
      latest.errosPorTipo = pick(data, "errosPorTipo", "ErrosPorTipo", "errorsByType") || latest.errosPorTipo;
      latest.timeline = Array.isArray(data.timeline) ? data.timeline : latest.timeline;
      latest.workers = Array.isArray(data.workers) ? data.workers : latest.workers;
      return latest;
    }

    function normalizeHistoryItem(x) { const item = normalizeLatest(x); item.data = pick(x, "data", "Data", "heartbeat", "ultimaAtualizacao", "UltimaAtualizacao") || item.heartbeat; return item; }

    async function apiGet(path) { const r = await fetch(url(path), { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
    async function apiPost(path, payload) { const r = await fetch(url(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json().catch(() => ({ ok: true })); }

    async function refreshLatest() {
      try { State.latest = normalizeLatest(await apiGet("/api/telemetry/latest")); $("dataSourceSide").textContent = AppConfig.isLocal ? "LOCAL" : "DEV"; }
      catch (e) { State.latest = { ...Demo.latest, heartbeat: new Date().toISOString() }; $("dataSourceSide").textContent = "DEV"; }
      renderRealtime();
    }
    async function refreshHistory() {
      try { const data = await apiGet("/api/telemetry/history"); const items = Array.isArray(data) ? data : (data.items || []); State.history = items.map(normalizeHistoryItem); }
      catch (e) { State.history = Demo.history; }
      renderHistory();
    }
    async function refreshCommands() {
      try { const data = await apiGet("/api/commands"); State.commandAudit = Array.isArray(data) ? data : (data.items || []); }
      catch (e) { State.commandAudit = []; }
      renderCommandAudit();
    }

    function chart(id, options) {
      if (!window.ApexCharts) return;
      if (!State.charts[id]) { State.charts[id] = new ApexCharts($(id), options); State.charts[id].render(); }
      else State.charts[id].updateOptions(options, true, true);
    }
    function baseChartOptions() { return { chart: { toolbar: { show: false }, fontFamily: "Inter, Segoe UI, Arial" }, dataLabels: { enabled: false }, grid: { borderColor: colors.grid }, xaxis: { labels: { style: { colors: colors.muted } } }, yaxis: { labels: { style: { colors: colors.muted } } }, legend: { labels: { colors: colors.text } }, stroke: { curve: "smooth", width: 3 } }; }

    function effectiveRuntime(data = State.latest || Demo.latest) { const selected = normalizeRuntime(State.viewRuntime || "web"); return selected === "auto" ? normalizeRuntime(data.runtimeActual || "web") : selected; }
    function applyRuntimeView(data = State.latest || Demo.latest) {
      const viewRuntime = effectiveRuntime(data);
      document.querySelectorAll(".runtime-web-panel").forEach(el => el.classList.toggle("active", viewRuntime === "web"));
      document.querySelectorAll(".runtime-api-panel").forEach(el => el.classList.toggle("active", viewRuntime === "api"));
      document.querySelectorAll(".runtime-api-control").forEach(el => el.style.display = (State.selectedRuntime === "api" || State.selectedRuntime === "auto") ? "" : "none");
      document.querySelectorAll(".runtime-web-control").forEach(el => el.style.display = (State.selectedRuntime === "web" || State.selectedRuntime === "auto") ? "" : "none");
      $("runtimeViewLabel").textContent = runtimeDisplayName(viewRuntime);
      $("runtimeActualLabel").textContent = runtimeDisplayName(data.runtimeActual || viewRuntime);
      $("controlRuntimeActual").textContent = runtimeDisplayName(data.runtimeActual || viewRuntime);
      $("controlRuntimeRequested").textContent = runtimeDisplayName(State.selectedRuntime);
      $("controlRuntime").textContent = runtimeDisplayName(viewRuntime);
      $("runtimeViewSelector").value = viewRuntime;
      $("paramRuntime").value = State.selectedRuntime;
    }

    function renderRealtime() {
      const d = State.latest || Demo.latest;
      applyRuntimeView(d);
      const progress = ratio(d.cifsProcessados, d.cifsRecebidos);
      const successRate = ratio(d.cifsSucesso, d.cifsProcessados);
      const isFresh = isHeartbeatFresh(d.heartbeat);
      $("agentHealthText").textContent = isFresh ? "Activo" : "Sem heartbeat";
      $("agentHealthDot").className = `dot ${isFresh ? "" : "danger"}`;
      $("heartbeatDot").className = `dot ${isFresh ? "" : "danger"}`;
      $("executionStatus").textContent = d.estadoFinal || "--";
      $("currentExecutionId").textContent = `Execução #${d.idExecucao || "--"}`;
      $("lastHeartbeatSide").textContent = formatTime(d.heartbeat);
      $("executionProgressBar").style.width = `${Math.min(100, Math.max(0, progress))}%`;
      $("mReceived").textContent = formatNumber(d.cifsRecebidos); $("mFilesReceived").textContent = formatNumber(d.ficheirosRecebidos);
      $("mProcessed").textContent = formatNumber(d.cifsProcessados); $("mPending").textContent = formatNumber(Math.max(0, n(d.cifsRecebidos)-n(d.cifsProcessados))); $("mProgressPercent").textContent = formatPercent(progress);
      $("currentCif").textContent = d.cifActual || "--"; $("currentField").textContent = d.campoActual || "--"; $("currentFile").textContent = d.ficheiroActual || "--";
      $("kpiProcessed").textContent = formatNumber(d.cifsProcessados); $("kpiProcessedMeta").textContent = `${formatPercent(progress)} da fila`;
      $("kpiSuccess").textContent = formatNumber(d.cifsSucesso); $("kpiSuccessRate").textContent = formatPercent(successRate);
      $("kpiNotFound").textContent = formatNumber(d.cifsNaoEncontrado); $("kpiCifErrors").textContent = formatNumber(d.cifsComErro);
      $("kpiUploads").textContent = formatNumber(effectiveRuntime(d) === "api" ? (d.apiRequestsHoje || d.uploads) : d.uploads);
      $("kpiTransportLabel").textContent = effectiveRuntime(d) === "api" ? "Requests API" : "Uploads Feitos";
      $("kpiTransportMeta").textContent = effectiveRuntime(d) === "api" ? "Chamadas ao modelo por API" : "Ficheiros anexados ao agente";
      $("kpiModel").textContent = d.modeloSeleccionado || d.modeloActual || "--"; $("kpiModelMeta").textContent = `${formatNumber(d.fallbackCount || 0)} fallback(s)`;
      $("kpiBackoffTotal").textContent = `${formatNumber(d.tempoBackoffTotalMinutos)}m`; $("kpiFtp550").textContent = formatNumber(d.ficheirosFtp550); $("kpiModelErrors").textContent = formatNumber(n(d.timeoutsAgente)+n(d.errosDirectLine)); $("kpiTimeouts").textContent = formatNumber(d.timeoutsAgente);
      $("kpiNormalizations").textContent = formatNumber(d.normalizacoesSolicitadas); $("kpiNormalizationsMeta").textContent = `${formatNumber(d.normalizacoesComSucesso)} com sucesso`; $("kpiAvgTime").textContent = formatDuration(d.tempoMedioPorCif); $("kpiAvgTimeMeta").textContent = `Resposta agente: ${formatDuration(d.tempoMedioRespostaAgente)}`;
      $("apiWorkersActive").textContent = formatNumber(d.apiWorkersActivos); $("apiWorkersMeta").textContent = `${formatNumber(d.apiWorkersTotal)} workers configurados`; $("apiWorkersBackoff").textContent = formatNumber(d.apiWorkersBackoff);
      $("apiRpmActual").textContent = formatNumber(d.apiRpmActual); $("apiRpmMeta").textContent = `Limite: ${formatNumber(d.apiRpmLimit)}/min`; $("apiRpdToday").textContent = formatNumber(d.apiRpdHoje); $("apiRpdMeta").textContent = `Limite diário: ${formatNumber(d.apiRpdLimit)}`; $("apiTpmActual").textContent = formatNumber(d.apiTpmActual); $("apiTpmMeta").textContent = `Limite: ${formatNumber(d.apiTpmLimit)}/min`; $("apiTpdToday").textContent = formatNumber(d.apiTpdHoje); $("apiTpdMeta").textContent = `Limite diário: ${formatNumber(d.apiTpdLimit)}`;
      $("apiBatchSize").textContent = formatNumber(d.apiBatchSize); $("apiRequestsToday").textContent = formatNumber(d.apiRequestsHoje); $("apiInputTokens").textContent = formatNumber(d.apiInputTokens); $("apiOutputTokens").textContent = formatNumber(d.apiOutputTokens); $("apiEstimatedCost").textContent = `$${n(d.apiCustoEstimadoUsd).toFixed(2)}`; $("apiQuotaMeta").textContent = `${formatPercent(d.apiQuotaRestantePercent)} quota restante`;
      $("qualitySuccess").textContent = formatPercent(successRate); $("qualityInvalid").textContent = formatPercent(ratio(d.cifsInvalidos, d.cifsProcessados)); $("qualityError").textContent = formatPercent(ratio(d.cifsComErro, d.cifsProcessados)); $("qualityFtp").textContent = formatPercent(ratio(d.ficheirosFtp550, d.ficheirosAvaliados || d.ficheirosRecebidos)); $("qualityNormalization").textContent = formatPercent(ratio(d.normalizacoesComSucesso, d.normalizacoesSolicitadas));
      $("modelCurrent").textContent = d.modeloActual || "--"; $("modelFallbacks").textContent = formatNumber(d.fallbackCount); $("modelGlobalErrors").textContent = formatNumber(d.errosGlobaisConsecutivos); $("modelLastRequest").textContent = formatDateTime(d.ultimaRequisicao); $("modelNextRequest").textContent = formatDateTime(d.proximaRequisicaoPermitida);
      $("controlExecution").textContent = d.idExecucao || "--"; $("controlState").textContent = d.estadoFinal || "--"; $("controlModel").textContent = d.modeloSeleccionado || d.modeloActual || "--";
      renderWorkers(d.workers || []); renderCharts(d);
    }

    function renderCharts(d) {
      const timeline = (d.timeline && d.timeline.length ? d.timeline : Demo.latest.timeline).slice(-12);
      const labels = timeline.map(x => x.label || formatTime(x.timestamp || x.data));
      $("progressChartLastPoint").textContent = labels[labels.length - 1] || "--";
      chart("chartProgressDynamic", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "area", height: 190, foreColor: "#fff" }, colors: [colors.pink], xaxis: { categories: labels, labels: { style: { colors: "#fff" } } }, yaxis: { max: 100, labels: { style: { colors: "#fff" } } }, series: [{ name: "Progresso", data: timeline.map(x => n(x.progress)) }], fill: { opacity: 0.25 }, grid: { borderColor: "rgba(255,255,255,.12)" } });
      chart("chartRealtimeLine", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "line", height: 310 }, colors: [colors.blue, colors.green, colors.amber, colors.red], xaxis: { categories: labels }, series: [ { name: "Processados", data: timeline.map(x => n(x.processed)) }, { name: "Sucesso", data: timeline.map(x => n(x.success)) }, { name: "Não Encontrado", data: timeline.map(x => n(x.notFound)) }, { name: "Erros", data: timeline.map(x => n(x.errors)) } ] });
      chart("chartResultDonut", { chart: { type: "donut", height: 270, fontFamily: "Inter, Segoe UI, Arial" }, labels: ["Sucesso", "Não Encontrado", "Inválido", "Erro"], colors: [colors.green, colors.amber, colors.blue, colors.red], series: [n(d.cifsSucesso), n(d.cifsNaoEncontrado), n(d.cifsInvalidos), n(d.cifsComErro)], legend: { position: "bottom" }, dataLabels: { enabled: false } });
      const errorEntries = Object.entries(d.errosPorTipo || {});
      chart("chartErrorTypes", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "bar", height: 270 }, plotOptions: { bar: { horizontal: true, borderRadius: 6 } }, colors: [colors.red], xaxis: { categories: errorEntries.map(([k]) => k) }, series: [{ name: "Ocorrências", data: errorEntries.map(([,v]) => n(v)) }] });
    }

    function renderWorkers(workers) {
      const tbody = $("workersTableBody");
      tbody.innerHTML = workers.map(w => `<tr><td>${escapeHtml(w.id || w.worker || "--")}</td><td>${escapeHtml(w.estado || "--")}</td><td>${escapeHtml(w.processando || "--")}</td><td>${formatNumber(w.filaLocal)}</td><td>${escapeHtml(w.modelo || "--")}</td><td>${formatDateTime(w.ultimoHeartbeat)}</td><td><button class="button warning" data-command="PauseWorker" data-worker="${escapeHtml(w.id || "")}">Pausar</button></td></tr>`).join("") || `<tr><td colspan="7">Sem workers registados para este runtime.</td></tr>`;
    }

    function renderHistory() {
      const items = State.history.length ? State.history : Demo.history;
      const processed = items.reduce((a,x)=>a+n(x.cifsProcessados),0), success = items.reduce((a,x)=>a+n(x.cifsSucesso),0), ftp = items.reduce((a,x)=>a+n(x.ficheirosFtp550),0), avg = items.length ? items.reduce((a,x)=>a+n(x.tempoMedioPorCif),0)/items.length : 0;
      $("histExecutions").textContent = formatNumber(items.length); $("histProcessed").textContent = formatNumber(processed); $("histSuccessRate").textContent = formatPercent(ratio(success, processed)); $("histFtp550").textContent = formatNumber(ftp); $("histAvgTime").textContent = formatDuration(avg);
      $("historyTableBody").innerHTML = items.map(x => `<tr><td>${escapeHtml(x.idExecucao || "--")}</td><td>${formatDateTime(x.data || x.heartbeat)}</td><td>${escapeHtml(x.estadoFinal || "--")}</td><td>${runtimeDisplayName(x.runtimeActual)}</td><td>${escapeHtml(x.modeloSeleccionado || x.modeloActual || "--")}</td><td>${formatNumber(x.cifsProcessados)}</td><td>${formatNumber(x.cifsSucesso)}</td><td>${formatNumber(x.cifsInvalidos)}</td><td>${formatNumber(x.cifsComErro)}</td><td>${formatNumber(x.ficheirosFtp550)}</td><td>${formatDuration(x.tempoMedioPorCif)}</td></tr>`).join("");
      const labels = items.map(x => String(x.idExecucao || "--").slice(-8));
      chart("chartDailyKpis", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "bar", height: 310 }, colors: [colors.blue, colors.green], xaxis: { categories: labels }, series: [{ name: "Processados", data: items.map(x=>n(x.cifsProcessados)) }, { name: "Sucesso", data: items.map(x=>n(x.cifsSucesso)) }] });
      chart("chartPeriodKpis", { ...baseChartOptions(), chart: { ...baseChartOptions().chart, type: "line", height: 310 }, colors: [colors.green, colors.red, colors.amber], xaxis: { categories: labels }, series: [{ name: "Sucesso %", data: items.map(x=>Math.round(ratio(x.cifsSucesso,x.cifsProcessados))) }, { name: "Erro %", data: items.map(x=>Math.round(ratio(x.cifsComErro,x.cifsProcessados))) }, { name: "FTP 550 / Ficheiros %", data: items.map(x=>Math.round(ratio(x.ficheirosFtp550,x.ficheirosAvaliados || x.ficheirosRecebidos))) }] });
    }

    function renderCommandAudit() {
      const items = State.commandAudit || [];
      const last = items[0] || items[items.length - 1];
      $("controlLastCommand").textContent = last?.command || last?.tipo || "--";
      $("controlChangedBy").textContent = last?.requestedBy || last?.solicitadoPor || "--";
      $("commandAuditBody").innerHTML = items.map(x => `<tr><td>${formatDateTime(x.createdAt || x.dataHora || x.timestamp)}</td><td>${escapeHtml(x.command || x.tipo || "--")}</td><td>${escapeHtml(x.status || x.estado || "Pendente")}</td><td>${escapeHtml(x.requestedBy || x.solicitadoPor || "Dashboard")}</td><td>${escapeHtml(x.reason || x.motivo || "--")}</td></tr>`).join("") || `<tr><td colspan="5">Sem comandos registados.</td></tr>`;
    }

    async function sendCommand(command, extra = {}) {
      const payload = { command, requestedBy: "Dashboard", reason: $("changeReason")?.value || "", runtime: State.selectedRuntime, parameters: collectParameters(), ...extra };
      try { await apiPost("/api/commands", payload); await refreshCommands(); alert("Comando registado com sucesso."); }
      catch (e) { alert("Não foi possível registar o comando. Verifique a API do dashboard."); }
    }
    function collectParameters() { return { webModel: $("paramWebModel")?.value, apiModel: $("paramApiModel")?.value, intervalSeconds: $("paramInterval")?.value, maxGlobalErrors: $("paramGlobalErrors")?.value, logLevel: $("paramLogLevel")?.value, normalization: $("paramNormalization")?.value, workerCount: $("paramWorkerCount")?.value, batchSize: $("paramBatchSize")?.value, rpmLimit: $("paramRpmLimit")?.value, rpdLimit: $("paramRpdLimit")?.value, tpmLimit: $("paramTpmLimit")?.value, tpdLimit: $("paramTpdLimit")?.value }; }

    function bindEvents() {
      document.querySelectorAll("[data-local-only]").forEach(x => x.style.display = AppConfig.isLocal ? "" : "none");
      document.querySelectorAll(".nav button").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active")); btn.classList.add("active"); document.querySelectorAll(".page").forEach(p => p.classList.remove("active")); $(`page-${btn.dataset.page}`).classList.add("active"); State.activePage = btn.dataset.page; if (State.activePage === "history") refreshHistory(); if (State.activePage === "control") refreshCommands(); }));
      $("refreshNowBtn").addEventListener("click", () => { refreshLatest(); refreshHistory(); refreshCommands(); });
      $("runtimeViewSelector").addEventListener("change", e => { State.viewRuntime = normalizeRuntime(e.target.value); localStorage.setItem("ciViewRuntime", State.viewRuntime); renderRealtime(); });
      $("paramRuntime").addEventListener("change", e => { State.selectedRuntime = normalizeRuntime(e.target.value); localStorage.setItem("ciSelectedRuntime", State.selectedRuntime); applyRuntimeView(State.latest || Demo.latest); });
      $("applyRuntimeBtn").addEventListener("click", () => sendCommand("ApplyRuntimeSelection", { runtimeApplyMode: $("paramRuntimeApply").value }));
      $("saveParamsBtn").addEventListener("click", () => sendCommand("UpdateRuntimeParameters"));
      $("resetParamsBtn").addEventListener("click", () => { $("changeReason").value = ""; });
      document.body.addEventListener("click", e => { const btn = e.target.closest("[data-command]"); if (btn) sendCommand(btn.dataset.command, { worker: btn.dataset.worker || null }); });
      $("applyHistoryFilterBtn")?.addEventListener("click", refreshHistory);
    }

    async function setupLogs() {
      if (!AppConfig.isLocal || !$("logs")) return;
      function addLog(item) { const div = document.createElement("div"); const level = item.level || item.Level || "INF"; div.className = `log-line log-${level}`; div.textContent = `[${formatDateTime(item.timestamp || item.Timestamp)}] [${level}] ${item.message || item.Message || ""}`; $("logs").appendChild(div); $("logs").scrollTop = $("logs").scrollHeight; }
      try { (await apiGet("/api/logs?take=120")).forEach(addLog); } catch {}
      try { const events = new EventSource(url("/api/events")); events.onmessage = (event) => addLog(JSON.parse(event.data)); } catch {}
    }

    bindEvents();
    refreshLatest(); refreshHistory(); refreshCommands(); setupLogs();
    setInterval(refreshLatest, AppConfig.autoRefreshMs);
