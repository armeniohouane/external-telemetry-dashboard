const charts = new Map();
const runtimeSelect = document.getElementById('runtimeSelect');
const themeToggle = document.getElementById('themeToggle');
const refreshBtn = document.getElementById('refreshBtn');

// Utiliza a variável global definida no index.html para aceder à API (ex: Render)
const API_BASE = window.AGENT_API_BASE || '';
let pendingCommand = null;

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function apexTheme() {
  return document.body.classList.contains('dark') ? 'dark' : 'light';
}

async function api(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function destroyChart(id) {
  const chart = charts.get(id);
  if (chart) {
    chart.destroy();
    charts.delete(id);
  }
}

function mountChart(id, options) {
  destroyChart(id);
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  const chart = new ApexCharts(el, options);
  charts.set(id, chart);
  chart.render();
}

function createIcons() {
  if (window.lucide) lucide.createIcons();
}

function renderMetricCards(container, items, className = 'hero-card') {
  container.innerHTML = (items || []).map(item => `
    <div class="${className}">
      <div class="hero-label">${item.label}</div>
      <div class="hero-value">${item.value}</div>
    </div>
  `).join('');
}

function renderCardGroups(groups) {
  document.getElementById('cardGroups').innerHTML = (groups || []).map(group => `
    <section class="section-block">
      <div class="section-header">
        <h2 class="group-title">${group.title}</h2>
        <span class="group-note">${group.note}</span>
      </div>
      <div class="cards-grid">
        ${(group.cards || []).map(card => `
          <article class="card" style="--accent:${card.color}">
            <div class="card-head">
              <div class="card-title">${card.title}</div>
              <div class="card-icon"><i data-lucide="${card.icon}" width="15"></i></div>
            </div>
            <div class="card-value" style="${String(card.value).length > 12 ? 'font-size:21px;line-height:1.1' : ''}">${card.value}</div>
            <div class="card-sub">${card.sub}</div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function renderRows(id, rows) {
  document.getElementById(id).innerHTML = (rows || []).map(row => `
    <div class="list-row">
      <span>${row.label}</span>
      <strong class="${row.status || ''}">${row.value}</strong>
    </div>
  `).join('');
}

function renderTimeline(events) {
  const container = document.getElementById('timeline');
  container.innerHTML = (events.items || []).map(evt => {
    const statusClass = evt.estadoTarefa === 'Completed' ? 'success' : evt.estadoTarefa === 'Failed' ? 'error' : 'warning';
    const label = evt.estadoTarefa === 'Completed' ? 'Concluído' : evt.estadoTarefa === 'Failed' ? 'Falhou' : 'Em Progresso';
    return `
      <div class="log-line">
        <span class="seq">${String(evt.sequencia).padStart(6, '0')}</span>
        <span class="log-time">${evt.dataHora || '—'}</span>
        <span class="scope">${evt.escopo}</span>
        <span>${evt.runtime}</span>
        <span class="task">${evt.mensagem || evt.tarefa}</span>
        <span class="badge ${statusClass}">${label}</span>
      </div>
    `;
  }).join('');
}

function renderExecutionChart(series) {
  const theme = apexTheme();
  mountChart('executionChart', {
    chart: { type: 'line', height: 260, toolbar: { show: false }, foreColor: 'rgba(255,255,255,.78)' },
    theme: { mode: theme },
    colors: [cssVar('--blue'), cssVar('--green'), cssVar('--orange'), cssVar('--purple'), cssVar('--red')],
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 0, hover: { size: 5 } },
    series: [
      { name: 'Processados', data: series.processados || [] },
      { name: 'Sucesso', data: series.sucesso || [] },
      { name: 'Não Encontrado', data: series.naoEncontrado || [] },
      { name: 'Inválido', data: series.invalidos || [] },
      { name: 'Erro', data: series.erros || [] }
    ],
    xaxis: { categories: series.labels || [], labels: { rotate: -45 } },
    grid: { borderColor: cssVar('--line'), strokeDashArray: 4 },
    tooltip: { theme, shared: true, intersect: false },
    legend: { position: 'bottom' }
  });
}

function renderDonut(distribution) {
  const theme = apexTheme();
  const values = [distribution.sucesso || 0, distribution.naoEncontrado || 0, distribution.invalidos || 0, distribution.erros || 0];
  document.getElementById('donutTotal').textContent = values.reduce((acc, value) => acc + value, 0);
  mountChart('donutChart', {
    chart: { type: 'donut', height: 260, foreColor: 'rgba(255,255,255,.78)' },
    theme: { mode: theme },
    labels: ['Sucesso', 'Não Encontrado', 'Inválido', 'Erro'],
    colors: [cssVar('--green'), cssVar('--orange'), cssVar('--purple'), cssVar('--red')],
    series: values,
    legend: { position: 'bottom' },
    dataLabels: { enabled: false },
    tooltip: { theme, y: { formatter: value => `${value} CIFs` } },
    plotOptions: { pie: { donut: { size: '66%' } } }
  });
}

function renderErrors(errorData) {
  const theme = apexTheme();
  mountChart('errorChart', {
    chart: { type: 'bar', height: 305, toolbar: { show: false }, foreColor: cssVar('--muted') },
    theme: { mode: theme },
    colors: [cssVar('--red')],
    series: [{ name: 'Ocorrências', data: errorData.values || [] }],
    xaxis: { categories: errorData.labels || [] },
    plotOptions: { bar: { horizontal: true, borderRadius: 6 } },
    grid: { borderColor: cssVar('--line'), strokeDashArray: 4 },
    tooltip: { theme }
  });
}

async function loadSnapshot() {
  const runtime = runtimeSelect.value;
  const snapshot = await api(`/api/dashboard/snapshot?runtime=${encodeURIComponent(runtime)}`);

  document.getElementById('systemStateLabel').textContent = snapshot.estadoSistema || '—';
  document.getElementById('statusMessage').textContent = snapshot.estadoSistema || '—';
  document.getElementById('modeLabel').textContent = `Modo: ${snapshot.modoActual || '—'}`;
  document.getElementById('runtimeLabel').textContent = `Runtime: ${snapshot.runtimeActual || '—'}`;
  document.getElementById('heartbeatLabel').textContent = `Último Heartbeat: ${snapshot.ultimoHeartbeat || '—'}`;
  document.getElementById('progressFill').style.width = `${snapshot.percentualConcluido || 0}%`;

  renderMetricCards(document.getElementById('heroMetrics'), snapshot.heroMetrics || []);
  renderMetricCards(document.getElementById('heroBottom'), snapshot.heroBottom || []);
  renderCardGroups(snapshot.cardGroups || []);
  renderRows('qualityRows', snapshot.qualityRows || []);
  renderRows('modelRows', snapshot.modelRows || []);
  document.getElementById('payloadBlock').textContent = JSON.stringify(snapshot.payload || {}, null, 2);

  renderExecutionChart(snapshot.seriesUltimas3h || {});
  renderDonut(snapshot.distribuicaoResultados || { sucesso: 0, naoEncontrado: 0, invalidos: 0, erros: 0 });
  renderErrors(snapshot.erros || { labels: [], values: [] });

  createIcons();
}

async function loadEvents() {
  const events = await api('/api/dashboard/events?take=80');
  renderTimeline(events || { items: [] });
}

async function loadTelemetry() {
  const telemetry = await api('/api/dashboard/telemetry');
  document.getElementById('telemetryGrid').innerHTML = (telemetry.groups || []).map(group => `
    <article class="telemetry-card">
      <h3>${group.title}</h3>
      ${(group.rows || []).map(row => `
        <div class="telemetry-row">
          <span>${row.label}</span>
          <strong class="${row.status || ''}">${row.value}</strong>
        </div>
      `).join('')}
    </article>
  `).join('');
}

async function loadHistory() {
  const history = await api('/api/dashboard/history');
  document.getElementById('historyCards').innerHTML = (history.cards || []).map(card => `
    <article class="card" style="--accent:${card.color}">
      <div class="card-head"><div class="card-title">${card.title}</div><div class="card-icon"><i data-lucide="${card.icon}" width="15"></i></div></div>
      <div class="card-value">${card.value}</div><div class="card-sub">${card.sub}</div>
    </article>
  `).join('');

  document.getElementById('historyBody').innerHTML = (history.items || []).map(row => {
    const cls = (row.estado || '').includes('Erro') ? 'error' : (row.estado || '').includes('Execução') ? 'warning' : 'success';
    return `<tr><td><strong>${row.idExecucao}</strong></td><td>${row.data}</td><td>${row.modo}</td><td>${row.runtime}</td><td><span class="status-inline ${cls}">${row.estado}</span></td><td>${row.cifsProcessados}</td><td>${row.taxaSucesso}</td><td>${row.erros}</td><td>${row.duracao}</td></tr>`;
  }).join('');

  const theme = apexTheme();
  mountChart('historyChart', {
    chart: { type: 'line', height: 260, toolbar: { show: false }, foreColor: 'rgba(255,255,255,.78)' },
    theme: { mode: theme },
    colors: [cssVar('--blue'), cssVar('--green')],
    series: [
      { name: 'CIFs Processados', type: 'column', data: history.chart?.cifsProcessados || [] },
      { name: 'Taxa Sucesso %', type: 'line', data: history.chart?.taxaSucesso || [] }
    ],
    xaxis: { categories: history.chart?.labels || [] },
    yaxis: [{ title: { text: 'CIFs' } }, { opposite: true, min: 0, max: 100, title: { text: '%' } }],
    grid: { borderColor: cssVar('--line'), strokeDashArray: 4 },
    tooltip: { theme, shared: true, intersect: false },
    legend: { position: 'bottom' }
  });
  createIcons();
}

function valueBool(id) {
  const el = document.getElementById(id);
  return el ? el.value === 'true' : false;
}

function valueInt(id) {
  const el = document.getElementById(id);
  return el ? Number.parseInt(el.value, 10) || 0 : 0;
}

// Intercepta a chamada para pedir a senha antes do envio do comando Live Control
function sendCommand(command, payload = {}) {
  pendingCommand = { command, payload };
  const pwdInput = document.getElementById('pwdInput');
  const pwdError = document.getElementById('pwdError');
  const pwdOverlay = document.getElementById('pwdOverlay');
  
  if (pwdInput) pwdInput.value = '';
  if (pwdError) pwdError.hidden = true;
  if (pwdOverlay) pwdOverlay.hidden = false;
  if (pwdInput) pwdInput.focus();
}

async function executeCommand(command, payload = {}) {
  const pwdInput = document.getElementById('pwdInput');
  const password = pwdInput ? pwdInput.value : '';

  try {
    const result = await api('/api/live-control/command', {
      method: 'POST',
      headers: {
        'X-Api-Key': password,
        'Authorization': `Bearer ${password}`
      },
      body: JSON.stringify({ command, payload })
    });

    const status = document.getElementById('statusMessage');
    if (result?.ok === false) {
      status.textContent = result.message || `Comando recusado: ${command}`;
    } else if (result?.message) {
      status.textContent = result.message;
    }

    await loadLiveControl();
    await loadSnapshot();
    await loadEvents();
    return result;
  } catch (error) {
    console.error('Command Error:', error);
    const status = document.getElementById('statusMessage');
    if (status) status.textContent = 'Erro ao enviar comando.';
  }
}

// Verifica se a senha corresponde e avança com a execução
function verifyPasswordAndSend() {
  const pwdInput = document.getElementById('pwdInput');
  const pwdError = document.getElementById('pwdError');
  const pwdOverlay = document.getElementById('pwdOverlay');

  if (pwdInput && pwdInput.value === 'Zeux') {
    if (pwdOverlay) pwdOverlay.hidden = true;
    if (pendingCommand) {
      executeCommand(pendingCommand.command, pendingCommand.payload);
      pendingCommand = null;
    }
  } else {
    if (pwdError) pwdError.hidden = false;
  }
}

function closePasswordModal() {
  const pwdOverlay = document.getElementById('pwdOverlay');
  if (pwdOverlay) pwdOverlay.hidden = true;
  pendingCommand = null;
}

function bindPasswordModal() {
  const pwdConfirmBtn = document.getElementById('pwdConfirmBtn');
  const pwdCancelBtn = document.getElementById('pwdCancelBtn');
  const pwdInput = document.getElementById('pwdInput');
  const pwdShowBtn = document.getElementById('pwdShowBtn');
  
  if (pwdConfirmBtn) pwdConfirmBtn.addEventListener('click', verifyPasswordAndSend);
  if (pwdCancelBtn) pwdCancelBtn.addEventListener('click', closePasswordModal);
  
  if (pwdInput) {
    pwdInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') verifyPasswordAndSend();
    });
  }

  if (pwdShowBtn) {
    pwdShowBtn.addEventListener('click', () => {
      const input = document.getElementById('pwdInput');
      const icon = document.getElementById('pwdEyeIcon');
      if (input && input.type === 'password') {
        input.type = 'text';
        if (icon) icon.setAttribute('data-lucide', 'eye-off');
      } else if (input) {
        input.type = 'password';
        if (icon) icon.setAttribute('data-lucide', 'eye');
      }
      createIcons();
    });
  }
}

function renderWorkers(workers) {
  document.getElementById('workersList').innerHTML = (workers || []).map(worker => `
    <div class="worker-row">
      <div>
        <div class="worker-name">${worker.workerId}</div>
        <div class="worker-meta">${worker.runtime} · ${worker.estado} · CIF ${worker.cifActual || '—'} · ${worker.campoActual || '—'}</div>
      </div>
      <div class="worker-actions">
        <button class="small-btn warn" data-worker-command="PauseWorker" data-worker-id="${worker.workerId}"><i data-lucide="pause" width="13"></i>Pausar</button>
        <button class="small-btn success" data-worker-command="ResumeWorker" data-worker-id="${worker.workerId}"><i data-lucide="play" width="13"></i>Retomar</button>
        <button class="small-btn danger" data-worker-command="RemoveWorker" data-worker-id="${worker.workerId}"><i data-lucide="trash-2" width="13"></i>Eliminar</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-worker-command]').forEach(btn => {
    btn.addEventListener('click', () => sendCommand(btn.dataset.workerCommand, { workerId: btn.dataset.workerId }));
  });
}

async function loadLiveControl() {
  try {
    const state = await api('/api/live-control/state');
    if (!state) return;

    if (state.apiWorkers) {
      document.getElementById('apiWorkerCount').value = state.apiWorkers.numeroWorkers || 0;
      document.getElementById('apiBatchSize').value = state.apiWorkers.batchPorWorker || 0;
      document.getElementById('apiAllowClaims').value = String(state.apiWorkers.permitirNovosClaims);
      document.getElementById('apiShutdownAfterCif').value = String(state.apiWorkers.encerrarAposCifActual);
      document.getElementById('apiWorkersStatus').textContent = `${state.apiWorkers.numeroWorkers || 0} Activos`;
    }

    if (state.modoOperacao) {
      document.getElementById('modeInput').value = state.modoOperacao.modo || 'Automático';
      document.getElementById('respectWindowInput').value = String(state.modoOperacao.respeitarJanela);
      document.getElementById('ftpOutsideOnlineInput').value = String(state.modoOperacao.permitirFtpForaDoOnline);
      document.getElementById('offlineLocalOnlyInput').value = String(state.modoOperacao.offlineUsaApenasLocal);
      document.getElementById('shutdownModeInput').value = state.modoOperacao.encerrarNaTroca || 'Não Encerrar';
      document.getElementById('customWindowInput').value = state.modoOperacao.janelaCustom || '';
    }

    if (state.webWorker) {
      document.getElementById('webActive').value = String(state.webWorker.activo);
      document.getElementById('webInterval').value = state.webWorker.intervaloPromptSegundos || 0;
      document.getElementById('webTimeout').value = state.webWorker.timeoutRespostaSegundos || 0;
      document.getElementById('webErrors').value = state.webWorker.maxErrosConsecutivos || 0;
    }

    if (state.staging) {
      document.getElementById('stagingCifs').value = state.staging.cifsParaPreparar || 0;
      document.getElementById('stagingDisk').value = state.staging.maxGbDisco || 0;
      document.getElementById('stagingFiles').value = state.staging.maxFicheirosPorCif || 0;
      document.getElementById('stagingPriority').value = state.staging.prioridade || 'Normal';
      document.getElementById('stagingReplace').value = String(state.staging.substituirExistentes);
      document.getElementById('stagingValidate').value = String(state.staging.validarFtpAntes);
    }

    if (state.rateLimits) {
      document.getElementById('rateRpm').value = state.rateLimits.rpm || 0;
      document.getElementById('rateRpd').value = state.rateLimits.rpd || 0;
      document.getElementById('rateTpm').value = state.rateLimits.tpm || 0;
      document.getElementById('rateInterval').value = state.rateLimits.intervaloMinimoSegundos || 0;
      document.getElementById('rateBackoff').value = state.rateLimits.tempoBackoffMinutos || 0;
      document.getElementById('rateErrors').value = state.rateLimits.errosGlobaisPermitidos || 0;
    }

    renderWorkers(state.workers || []);
    createIcons();
  } catch (error) {
    console.warn('Live control state load failed', error);
  }
}

function bindControls() {
  document.querySelectorAll('[data-command]').forEach(btn => {
    btn.addEventListener('click', () => sendCommand(btn.dataset.command));
  });

  const btnApplyMode = document.getElementById('applyModeBtn');
  if (btnApplyMode) {
    btnApplyMode.addEventListener('click', () => sendCommand('UpdateOperationMode', {
      modo: document.getElementById('modeInput').value,
      respeitarJanela: valueBool('respectWindowInput'),
      permitirFtpForaDoOnline: valueBool('ftpOutsideOnlineInput'),
      offlineUsaApenasLocal: valueBool('offlineLocalOnlyInput'),
      encerrarNaTroca: document.getElementById('shutdownModeInput').value,
      janelaCustom: document.getElementById('customWindowInput').value
    }));
  }

  const btnIncWorkers = document.getElementById('increaseWorkersBtn');
  if (btnIncWorkers) btnIncWorkers.addEventListener('click', () => sendCommand('IncreaseApiWorkerCount'));
  
  const btnDecWorkers = document.getElementById('decreaseWorkersBtn');
  if (btnDecWorkers) btnDecWorkers.addEventListener('click', () => sendCommand('DecreaseApiWorkerCount'));
  
  const btnApplyWorkers = document.getElementById('applyWorkersBtn');
  if (btnApplyWorkers) {
    btnApplyWorkers.addEventListener('click', () => sendCommand('UpdateApiWorkers', {
      numeroWorkers: valueInt('apiWorkerCount'),
      batchPorWorker: valueInt('apiBatchSize'),
      permitirNovosClaims: valueBool('apiAllowClaims'),
      encerrarAposCifActual: valueBool('apiShutdownAfterCif')
    }));
  }

  const btnApplyWeb = document.getElementById('applyWebBtn');
  if (btnApplyWeb) {
    btnApplyWeb.addEventListener('click', () => sendCommand('UpdateWebWorkerSettings', {
      activo: valueBool('webActive'),
      intervaloPromptSegundos: valueInt('webInterval'),
      timeoutRespostaSegundos: valueInt('webTimeout'),
      maxErrosConsecutivos: valueInt('webErrors')
    }));
  }

  const btnApplyStaging = document.getElementById('applyStagingBtn');
  if (btnApplyStaging) {
    btnApplyStaging.addEventListener('click', () => sendCommand('UpdateStagingSettings', {
      cifsParaPreparar: valueInt('stagingCifs'),
      maxGbDisco: valueInt('stagingDisk'),
      maxFicheirosPorCif: valueInt('stagingFiles'),
      prioridade: document.getElementById('stagingPriority').value,
      substituirExistentes: valueBool('stagingReplace'),
      validarFtpAntes: valueBool('stagingValidate')
    }));
  }

  const btnApplyRate = document.getElementById('applyRateBtn');
  if (btnApplyRate) {
    btnApplyRate.addEventListener('click', () => sendCommand('UpdateRateLimits', {
      rpm: valueInt('rateRpm'),
      rpd: valueInt('rateRpd'),
      tpm: valueInt('rateTpm'),
      intervaloMinimoSegundos: valueInt('rateInterval'),
      tempoBackoffMinutos: valueInt('rateBackoff'),
      errosGlobaisPermitidos: valueInt('rateErrors')
    }));
  }
}

async function refreshAll() {
  try {
    await Promise.all([
      loadSnapshot().catch(() => {}),
      loadEvents().catch(() => {}),
      loadTelemetry().catch(() => {}),
      loadHistory().catch(() => {}),
      loadLiveControl().catch(() => {})
    ]);
    createIcons();
  } catch (error) {
    console.error(error);
    const status = document.getElementById('statusMessage');
    if (status) status.textContent = 'Erro ao carregar dados do backend';
  }
}

function bindNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.view).classList.add('active');
      await refreshAll();
    });
  });
}

function bindTheme() {
  const stored = localStorage.getItem('agente-dashboard-theme');
  if (stored === 'dark') document.body.classList.add('dark');
  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) themeIcon.setAttribute('data-lucide', document.body.classList.contains('dark') ? 'sun' : 'moon');
  
  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('agente-dashboard-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
      if (themeIcon) themeIcon.setAttribute('data-lucide', document.body.classList.contains('dark') ? 'sun' : 'moon');
      createIcons();
      await refreshAll();
    });
  }
}

// Inicializações principais
if (runtimeSelect) runtimeSelect.addEventListener('change', loadSnapshot);
if (refreshBtn) refreshBtn.addEventListener('click', refreshAll);

bindNavigation();
bindTheme();
bindPasswordModal();
bindControls();

refreshAll();

setInterval(() => {
  loadSnapshot().catch(() => {});
  loadEvents().catch(() => {});
}, 3000);

setInterval(() => {
  loadTelemetry().catch(() => {});
}, 5000);

createIcons();