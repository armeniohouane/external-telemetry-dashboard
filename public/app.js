/* ─────────────────────────────────────────────────────────────────────────
   app.js  –  Agente Clientes Irregulares · Dashboard
   ───────────────────────────────────────────────────────────────────────── */

/* ── API base URL ───────────────────────────────────────────────────────── *
 * Reads window.AGENT_API_BASE (set in index.html <script> block).          *
 * If blank, all requests are relative (same-origin / local dev).           *
 * On Render you can override it by injecting a value via _headers or a     *
 * tiny server-side script that replaces the placeholder at build time.     *
 * ─────────────────────────────────────────────────────────────────────── */
const API_BASE = (window.AGENT_API_BASE || '').replace(/\/$/, '');

function apiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

/* ── Globals ────────────────────────────────────────────────────────────── */
const charts       = new Map();
const runtimeSelect = document.getElementById('runtimeSelect');
const themeToggle  = document.getElementById('themeToggle');
const refreshBtn   = document.getElementById('refreshBtn');

/* ── Helpers ────────────────────────────────────────────────────────────── */
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function apexTheme() {
  return document.body.classList.contains('dark') ? 'dark' : 'light';
}

async function api(path, options = {}) {
  const token = localStorage.getItem('dashboard_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(apiUrl(path), { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function destroyChart(id) {
  const chart = charts.get(id);
  if (chart) { chart.destroy(); charts.delete(id); }
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

/* ═══════════════════════════════════════════════════════════════════════════
   PASSWORD GATE  –  protects every Live Control action
   ═══════════════════════════════════════════════════════════════════════════
   Usage:
     const ok = await requireAuth();
     if (!ok) return;
     // proceed with command
   ─────────────────────────────────────────────────────────────────────── */
const CONTROL_PASSWORD = 'Zeux';

let _pwdResolve = null;   // resolves the current auth Promise

const pwdOverlay  = document.getElementById('pwdOverlay');
const pwdInput    = document.getElementById('pwdInput');
const pwdError    = document.getElementById('pwdError');
const pwdConfirm  = document.getElementById('pwdConfirmBtn');
const pwdCancel   = document.getElementById('pwdCancelBtn');
const pwdShowBtn  = document.getElementById('pwdShowBtn');
const pwdEyeIcon  = document.getElementById('pwdEyeIcon');

function showPwdModal() {
  pwdInput.value = '';
  pwdError.hidden = true;
  pwdOverlay.hidden = false;
  setTimeout(() => pwdInput.focus(), 60);
  createIcons();
}

function closePwdModal(result) {
  pwdOverlay.hidden = true;
  if (_pwdResolve) { _pwdResolve(result); _pwdResolve = null; }
}

function requireAuth() {
  return new Promise(resolve => {
    _pwdResolve = resolve;
    showPwdModal();
  });
}

function handlePwdConfirm() {
  if (pwdInput.value === CONTROL_PASSWORD) {
    closePwdModal(true);
  } else {
    pwdError.hidden = false;
    pwdInput.value = '';
    pwdInput.focus();
  }
}

pwdConfirm.addEventListener('click', handlePwdConfirm);
pwdCancel.addEventListener('click', () => closePwdModal(false));
pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') handlePwdConfirm(); });

// Allow closing with Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !pwdOverlay.hidden) closePwdModal(false);
});

// Show/hide password toggle
pwdShowBtn.addEventListener('click', () => {
  const isText = pwdInput.type === 'text';
  pwdInput.type = isText ? 'password' : 'text';
  pwdEyeIcon.setAttribute('data-lucide', isText ? 'eye' : 'eye-off');
  createIcons();
});

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD AUTH  –  login com matrícula, sessão de 10 min
   ═══════════════════════════════════════════════════════════════════════════
   O acesso ao dashboard requer apenas a matrícula (sem senha).
   A senha é usada apenas no Live Control (modal pwdOverlay separado).
   ─────────────────────────────────────────────────────────────────────── */
let dashboardAuthenticated = false;
let _sessionTimer    = null;
let _sessionCountdown = null;

/* ── Auth DOM refs ──────────────────────────────────────────────────────── */
const authOverlay   = document.getElementById('authOverlay');
const authUser      = document.getElementById('authUser');
const authError     = document.getElementById('authError');
const authLoginBtn  = document.getElementById('authLoginBtn');
const authSkipBtn   = document.getElementById('authSkipBtn');
const authBtn       = document.getElementById('authBtn');
const authBtnIcon   = document.getElementById('authBtnIcon');
const authBtnLabel  = document.getElementById('authBtnLabel');

/* ── Token helpers ──────────────────────────────────────────────────────── */
function getToken()       { return localStorage.getItem('dashboard_token'); }
function setToken(token)  { localStorage.setItem('dashboard_token', token); }
function clearToken()     { localStorage.removeItem('dashboard_token'); localStorage.removeItem('dashboard_token_expiry'); }

/* ── Show / Hide auth overlay ───────────────────────────────────────────── */
function showAuthOverlay() {
  authUser.value = '';
  authError.hidden = true;
  authOverlay.hidden = false;
  setTimeout(() => authUser.focus(), 80);
  createIcons();
}

function hideAuthOverlay() {
  authOverlay.hidden = true;
}

/* ── Update header button state ─────────────────────────────────────────── */
function updateAuthButton() {
  if (dashboardAuthenticated) {
    authBtnIcon.setAttribute('data-lucide', 'log-out');
    authBtnLabel.textContent = 'Sair';
    authBtn.classList.add('logged-in');
    document.body.classList.remove('public-view');
  } else {
    authBtnIcon.setAttribute('data-lucide', 'log-in');
    authBtnLabel.textContent = 'Entrar';
    authBtn.classList.remove('logged-in');
    document.body.classList.add('public-view');
  }
  createIcons();
}

/* ── Session timer (auto-logout após expirar) ───────────────────────────── */
function startSessionTimer(expiresInMs) {
  clearSessionTimer();
  _sessionTimer = setTimeout(() => {
    doLogout('Sessão expirada. Introduza a matrícula novamente.');
  }, expiresInMs);
}

function clearSessionTimer() {
  if (_sessionTimer)    { clearTimeout(_sessionTimer);    _sessionTimer    = null; }
  if (_sessionCountdown) { clearInterval(_sessionCountdown); _sessionCountdown = null; }
}

/* ── Login (apenas matrícula) ────────────────────────────────────────────── */
async function doLogin() {
  const user = authUser.value.trim();

  if (!user) {
    authError.textContent = 'Introduza a sua matrícula.';
    authError.hidden = false;
    return;
  }

  authLoginBtn.disabled = true;
  authLoginBtn.textContent = 'A entrar…';

  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      authError.textContent = data.message || 'Matrícula não autorizada.';
      authError.hidden = false;
      authUser.value = '';
      authUser.focus();
      return;
    }

    /* Sucesso */
    setToken(data.token);
    dashboardAuthenticated = true;
    hideAuthOverlay();
    updateAuthButton();
    startSessionTimer(data.expiresIn || 10 * 60 * 1000);
    await refreshAll();

  } catch (err) {
    authError.textContent = 'Erro de ligação ao servidor.';
    authError.hidden = false;
    console.error('Login error:', err);
  } finally {
    authLoginBtn.disabled = false;
    authLoginBtn.innerHTML = '<i data-lucide="log-in" width="13"></i>Entrar';
    createIcons();
  }
}

/* ── Logout ──────────────────────────────────────────────────────────────── */
async function doLogout(reason) {
  try {
    const token = getToken();
    if (token) {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    }
  } catch { /* ignorar */ }

  clearToken();
  clearSessionTimer();
  dashboardAuthenticated = false;
  updateAuthButton();

  if (reason) {
    authError.textContent = reason;
    authError.hidden = false;
  }

  showAuthOverlay();
  renderRestrictedSections();
  createIcons();
}

/* ── Verificar sessão existente no arranque ───────────────────────────────── */
async function ensureDashboardAuth() {
  const token = getToken();
  if (!token) {
    dashboardAuthenticated = false;
    updateAuthButton();
    showAuthOverlay();
    return false;
  }

  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();

    if (res.ok && data.authenticated) {
      dashboardAuthenticated = true;
      hideAuthOverlay();
      updateAuthButton();

      /* Calcular TTL restante */
      const expiresAt = new Date(data.expiresAt).getTime();
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        startSessionTimer(remaining);
      } else {
        await doLogout('Sessão expirada.');
        return false;
      }
      return true;
    }
  } catch { /* sessão inválida */ }

  clearToken();
  dashboardAuthenticated = false;
  updateAuthButton();
  showAuthOverlay();
  return false;
}

/* ── Auth event bindings ─────────────────────────────────────────────────── */
authLoginBtn.addEventListener('click', doLogin);
authUser.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
authSkipBtn.addEventListener('click', () => {
  hideAuthOverlay();
  renderRestrictedSections();
});

/* Header auth button: Entrar ou Sair */
authBtn.addEventListener('click', () => {
  if (dashboardAuthenticated) {
    doLogout();
  } else {
    showAuthOverlay();
  }
});

/* Fechar auth overlay com Escape */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !authOverlay.hidden) {
    hideAuthOverlay();
    renderRestrictedSections();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   RENDER HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderMetricCards(container, items, className = 'hero-card') {
  container.innerHTML = items.map(item => `
    <div class="${className}">
      <div class="hero-label">${item.label}</div>
      <div class="hero-value">${item.value}</div>
    </div>
  `).join('');
}

function renderCardGroups(groups) {
  document.getElementById('cardGroups').innerHTML = groups.map(group => `
    <section class="section-block">
      <div class="section-header">
        <h2 class="group-title">${group.title}</h2>
        <span class="group-note">${group.note}</span>
      </div>
      <div class="cards-grid">
        ${group.cards.map(card => `
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
  document.getElementById(id).innerHTML = rows.map(row => `
    <div class="list-row">
      <span>${row.label}</span>
      <strong class="${row.status || ''}">${row.value}</strong>
    </div>
  `).join('');
}

function renderTimeline(events) {
  const container = document.getElementById('timeline');
  container.innerHTML = events.items.map(evt => {
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

/* ── Charts ─────────────────────────────────────────────────────────────── */
function renderExecutionChart(series) {
  const theme = apexTheme();
  mountChart('executionChart', {
    chart: { type: 'line', height: 260, toolbar: { show: false }, foreColor: 'rgba(255,255,255,.78)' },
    theme: { mode: 'dark' },
    colors: [cssVar('--blue'), cssVar('--green'), cssVar('--orange'), cssVar('--purple'), cssVar('--red')],
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 0, hover: { size: 5 } },
    series: [
      { name: 'Processados',   data: series.processados   || [] },
      { name: 'Sucesso',       data: series.sucesso       || [] },
      { name: 'Não Encontrado',data: series.naoEncontrado || [] },
      { name: 'Inválido',      data: series.invalidos     || [] },
      { name: 'Erro',          data: series.erros         || [] },
    ],
    xaxis: { categories: series.labels || [], labels: { rotate: -45 } },
    grid: { borderColor: cssVar('--line'), strokeDashArray: 4 },
    tooltip: { theme, shared: true, intersect: false },
    legend: { position: 'bottom' },
  });
}

function renderDonut(distribution) {
  const theme = apexTheme();
  const values = [distribution.sucesso, distribution.naoEncontrado, distribution.invalidos, distribution.erros];
  document.getElementById('donutTotal').textContent = values.reduce((a, v) => a + v, 0);
  mountChart('donutChart', {
    chart: { type: 'donut', height: 260, foreColor: 'rgba(255,255,255,.78)' },
    theme: { mode: 'dark' },
    labels: ['Sucesso', 'Não Encontrado', 'Inválido', 'Erro'],
    colors: [cssVar('--green'), cssVar('--orange'), cssVar('--purple'), cssVar('--red')],
    series: values,
    legend: { position: 'bottom' },
    dataLabels: { enabled: false },
    tooltip: { theme, y: { formatter: v => `${v} CIFs` } },
    plotOptions: { pie: { donut: { size: '66%' } } },
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
    tooltip: { theme },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA LOADERS
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadSnapshot() {
  const runtime  = runtimeSelect.value;
  const snapshot = await api(`/api/dashboard/snapshot?runtime=${encodeURIComponent(runtime)}`);

  document.getElementById('systemStateLabel').textContent = snapshot.estadoSistema;
  document.getElementById('statusMessage').textContent    = snapshot.estadoSistema;
  document.getElementById('modeLabel').textContent        = `Modo: ${snapshot.modoActual}`;
  document.getElementById('runtimeLabel').textContent     = `Runtime: ${snapshot.runtimeActual}`;
  document.getElementById('heartbeatLabel').textContent   = `Último Heartbeat: ${snapshot.ultimoHeartbeat}`;
  document.getElementById('progressFill').style.width     = `${snapshot.percentualConcluido}%`;

  renderMetricCards(document.getElementById('heroMetrics'), snapshot.heroMetrics || []);
  renderMetricCards(document.getElementById('heroBottom'),  snapshot.heroBottom  || []);
  renderCardGroups(snapshot.cardGroups || []);
  renderRows('qualityRows', snapshot.qualityRows || []);
  renderRows('modelRows',   snapshot.modelRows   || []);
  document.getElementById('payloadBlock').textContent = JSON.stringify(snapshot.payload || {}, null, 2);

  renderExecutionChart(snapshot.seriesUltimas3h || {});
  renderDonut(snapshot.distribuicaoResultados || { sucesso: 0, naoEncontrado: 0, invalidos: 0, erros: 0 });
  renderErrors(snapshot.erros || { labels: [], values: [] });

  createIcons();
}

async function loadEvents() {
  const events = await api('/api/dashboard/events?take=80');
  renderTimeline(events);
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
      <div class="card-head">
        <div class="card-title">${card.title}</div>
        <div class="card-icon"><i data-lucide="${card.icon}" width="15"></i></div>
      </div>
      <div class="card-value">${card.value}</div>
      <div class="card-sub">${card.sub}</div>
    </article>
  `).join('');

  document.getElementById('historyBody').innerHTML = (history.items || []).map(row => {
    const cls = row.estado.includes('Erro') ? 'error' : row.estado.includes('Execução') ? 'warning' : 'success';
    return `<tr>
      <td><strong>${row.idExecucao}</strong></td>
      <td>${row.data}</td>
      <td>${row.modo}</td>
      <td>${row.runtime}</td>
      <td><span class="status-inline ${cls}">${row.estado}</span></td>
      <td>${row.cifsProcessados}</td>
      <td>${row.taxaSucesso}</td>
      <td>${row.erros}</td>
      <td>${row.duracao}</td>
    </tr>`;
  }).join('');

  const theme = apexTheme();
  mountChart('historyChart', {
    chart: { type: 'line', height: 260, toolbar: { show: false }, foreColor: cssVar('--muted') },
    theme: { mode: theme },
    colors: [cssVar('--blue'), cssVar('--green')],
    series: [
      { name: 'CIFs Processados', type: 'column', data: history.chart?.cifsProcessados || [] },
      { name: 'Taxa Sucesso %',   type: 'line',   data: history.chart?.taxaSucesso     || [] },
    ],
    xaxis: { categories: history.chart?.labels || [] },
    yaxis: [
      { title: { text: 'CIFs' } },
      { opposite: true, min: 0, max: 100, title: { text: '%' } },
    ],
    grid: { borderColor: cssVar('--line'), strokeDashArray: 4 },
    tooltip: { theme, shared: true, intersect: false },
    legend: { position: 'bottom' },
  });
  createIcons();
}

function valueBool(id) {
  return document.getElementById(id).value === 'true';
}
function valueInt(id) {
  return Number.parseInt(document.getElementById(id).value, 10) || 0;
}

/* ── Send command (password-gated) ──────────────────────────────────────── */
async function sendCommand(command, payload = {}) {
  const authed = await requireAuth();
  if (!authed) return null;

  let result;
  try {
    result = await api('/api/live-control/command', {
      method: 'POST',
      body: JSON.stringify({ command, payload }),
    });
  } catch (err) {
    document.getElementById('statusMessage').textContent = `Erro ao enviar comando: ${err.message}`;
    return null;
  }

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
}

/* ── Workers list ───────────────────────────────────────────────────────── */
function renderWorkers(workers) {
  document.getElementById('workersList').innerHTML = (workers || []).map(worker => `
    <div class="worker-row">
      <div>
        <div class="worker-name">${worker.workerId}</div>
        <div class="worker-meta">${worker.runtime} · ${worker.estado} · CIF ${worker.cifActual || '—'} · ${worker.campoActual || '—'}</div>
      </div>
      <div class="worker-actions">
        <button class="small-btn warn"   data-worker-command="PauseWorker"  data-worker-id="${worker.workerId}"><i data-lucide="pause"   width="13"></i>Pausar</button>
        <button class="small-btn success" data-worker-command="ResumeWorker" data-worker-id="${worker.workerId}"><i data-lucide="play"    width="13"></i>Retomar</button>
        <button class="small-btn danger"  data-worker-command="RemoveWorker" data-worker-id="${worker.workerId}"><i data-lucide="trash-2" width="13"></i>Eliminar</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-worker-command]').forEach(btn => {
    btn.addEventListener('click', () =>
      sendCommand(btn.dataset.workerCommand, { workerId: btn.dataset.workerId })
    );
  });
}

/* ── Load Live Control state ─────────────────────────────────────────────── */
async function loadLiveControl() {
  const state = await api('/api/live-control/state');

  document.getElementById('apiWorkerCount').value        = state.apiWorkers.numeroWorkers;
  document.getElementById('apiBatchSize').value          = state.apiWorkers.batchPorWorker;
  document.getElementById('apiAllowClaims').value        = String(state.apiWorkers.permitirNovosClaims);
  document.getElementById('apiShutdownAfterCif').value   = String(state.apiWorkers.encerrarAposCifActual);
  document.getElementById('apiWorkersStatus').textContent= `${state.apiWorkers.numeroWorkers} Activos`;

  document.getElementById('modeInput').value             = state.modoOperacao.modo;
  document.getElementById('respectWindowInput').value    = String(state.modoOperacao.respeitarJanela);
  document.getElementById('ftpOutsideOnlineInput').value = String(state.modoOperacao.permitirFtpForaDoOnline);
  document.getElementById('offlineLocalOnlyInput').value = String(state.modoOperacao.offlineUsaApenasLocal);
  document.getElementById('shutdownModeInput').value     = state.modoOperacao.encerrarNaTroca;
  document.getElementById('customWindowInput').value     = state.modoOperacao.janelaCustom;

  document.getElementById('webActive').value    = String(state.webWorker.activo);
  document.getElementById('webInterval').value  = state.webWorker.intervaloPromptSegundos;
  document.getElementById('webTimeout').value   = state.webWorker.timeoutRespostaSegundos;
  document.getElementById('webErrors').value    = state.webWorker.maxErrosConsecutivos;

  document.getElementById('stagingCifs').value     = state.staging.cifsParaPreparar;
  document.getElementById('stagingDisk').value     = state.staging.maxGbDisco;
  document.getElementById('stagingFiles').value    = state.staging.maxFicheirosPorCif;
  document.getElementById('stagingPriority').value = state.staging.prioridade;
  document.getElementById('stagingReplace').value  = String(state.staging.substituirExistentes);
  document.getElementById('stagingValidate').value = String(state.staging.validarFtpAntes);

  document.getElementById('rateRpm').value      = state.rateLimits.rpm;
  document.getElementById('rateRpd').value      = state.rateLimits.rpd;
  document.getElementById('rateTpm').value      = state.rateLimits.tpm;
  document.getElementById('rateInterval').value = state.rateLimits.intervaloMinimoSegundos;
  document.getElementById('rateBackoff').value  = state.rateLimits.tempoBackoffMinutos;
  document.getElementById('rateErrors').value   = state.rateLimits.errosGlobaisPermitidos;

  renderWorkers(state.workers || []);
  createIcons();
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTROLS BINDING  –  all buttons go through sendCommand (password-gated)
   ═══════════════════════════════════════════════════════════════════════════ */
function bindControls() {
  /* Generic data-command buttons */
  document.querySelectorAll('[data-command]').forEach(btn => {
    btn.addEventListener('click', () => sendCommand(btn.dataset.command));
  });

  /* Modo de Operação */
  document.getElementById('applyModeBtn').addEventListener('click', () =>
    sendCommand('UpdateOperationMode', {
      modo:                    document.getElementById('modeInput').value,
      respeitarJanela:         valueBool('respectWindowInput'),
      permitirFtpForaDoOnline: valueBool('ftpOutsideOnlineInput'),
      offlineUsaApenasLocal:   valueBool('offlineLocalOnlyInput'),
      encerrarNaTroca:         document.getElementById('shutdownModeInput').value,
      janelaCustom:            document.getElementById('customWindowInput').value,
    })
  );

  /* Workers API */
  document.getElementById('increaseWorkersBtn').addEventListener('click', () =>
    sendCommand('IncreaseApiWorkerCount')
  );
  document.getElementById('decreaseWorkersBtn').addEventListener('click', () =>
    sendCommand('DecreaseApiWorkerCount')
  );
  document.getElementById('applyWorkersBtn').addEventListener('click', () =>
    sendCommand('UpdateApiWorkers', {
      numeroWorkers:        valueInt('apiWorkerCount'),
      batchPorWorker:       valueInt('apiBatchSize'),
      permitirNovosClaims:  valueBool('apiAllowClaims'),
      encerrarAposCifActual:valueBool('apiShutdownAfterCif'),
    })
  );

  /* Web Worker */
  document.getElementById('applyWebBtn').addEventListener('click', () =>
    sendCommand('UpdateWebWorkerSettings', {
      activo:                    valueBool('webActive'),
      intervaloPromptSegundos:   valueInt('webInterval'),
      timeoutRespostaSegundos:   valueInt('webTimeout'),
      maxErrosConsecutivos:      valueInt('webErrors'),
    })
  );

  /* Staging */
  document.getElementById('applyStagingBtn').addEventListener('click', () =>
    sendCommand('UpdateStagingSettings', {
      cifsParaPreparar:    valueInt('stagingCifs'),
      maxGbDisco:          valueInt('stagingDisk'),
      maxFicheirosPorCif:  valueInt('stagingFiles'),
      prioridade:          document.getElementById('stagingPriority').value,
      substituirExistentes:valueBool('stagingReplace'),
      validarFtpAntes:     valueBool('stagingValidate'),
    })
  );

  /* Rate Limits */
  document.getElementById('applyRateBtn').addEventListener('click', () =>
    sendCommand('UpdateRateLimits', {
      rpm:                      valueInt('rateRpm'),
      rpd:                      valueInt('rateRpd'),
      tpm:                      valueInt('rateTpm'),
      intervaloMinimoSegundos:  valueInt('rateInterval'),
      tempoBackoffMinutos:      valueInt('rateBackoff'),
      errosGlobaisPermitidos:   valueInt('rateErrors'),
    })
  );
}


function renderRestrictedSections() {
  const restricted = `
    <div class="restricted-box">
      <strong>Secção restrita</strong>
      <span>Faça login para visualizar logs, payload, histórico, telemetria e Live Control.</span>
      <button class="small-btn primary" onclick="showAuthOverlay()"><i data-lucide="log-in" width="14"></i>Entrar</button>
    </div>`;

  const timeline = document.getElementById('timeline');
  if (timeline) timeline.innerHTML = restricted;
  const payload = document.getElementById('payloadBlock');
  if (payload) payload.textContent = 'Payload restrito. Faça login para visualizar.';
  const historyBody = document.getElementById('historyBody');
  if (historyBody) historyBody.innerHTML = '<tr><td colspan="9">Histórico restrito. Faça login para visualizar.</td></tr>';
  const telemetryGrid = document.getElementById('telemetryGrid');
  if (telemetryGrid) telemetryGrid.innerHTML = restricted;
  const workersList = document.getElementById('workersList');
  if (workersList) workersList.innerHTML = restricted;

  document.querySelectorAll('#live-control button, #live-control input, #live-control select').forEach(el => {
    if (el.id !== 'loginOpenBtn') el.disabled = true;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   GLOBAL REFRESH
   ═══════════════════════════════════════════════════════════════════════════ */
async function refreshAll() {
  try {
    if (!dashboardAuthenticated) {
      await loadSnapshot();
      renderRestrictedSections();
      createIcons();
      return;
    }

    await Promise.all([
      loadSnapshot(),
      loadEvents(),
      loadTelemetry(),
      loadHistory(),
      loadLiveControl(),
    ]);
    createIcons();
  } catch (error) {
    console.error(error);
    document.getElementById('statusMessage').textContent = dashboardAuthenticated
      ? 'Erro ao carregar dados do backend'
      : 'Visualização pública limitada. Faça login para ver detalhes.';
  }
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
function bindNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.view).classList.add('active');
      if (!dashboardAuthenticated && btn.dataset.view !== 'tempo-real') {
        renderRestrictedSections();
        showAuthOverlay();
        createIcons();
        return;
      }
      await refreshAll();
    });
  });
}

/* ── Theme ──────────────────────────────────────────────────────────────── */
function bindTheme() {
  const stored = localStorage.getItem('agente-dashboard-theme');
  if (stored === 'dark') document.body.classList.add('dark');
  document.getElementById('themeIcon').setAttribute('data-lucide',
    document.body.classList.contains('dark') ? 'sun' : 'moon');

  themeToggle.addEventListener('click', async () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('agente-dashboard-theme', isDark ? 'dark' : 'light');
    document.getElementById('themeIcon').setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    createIcons();
    await refreshAll();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════════════ */
runtimeSelect.addEventListener('change', () => { loadSnapshot().catch(console.error); });
refreshBtn.addEventListener('click', refreshAll);
bindNavigation();
bindTheme();
bindControls();

(async function boot() {
  createIcons();
  const ok = await ensureDashboardAuth();
  if (!ok) renderRestrictedSections();
  await refreshAll();
})();

/* Polling intervals */
setInterval(() => {
  loadSnapshot().catch(console.error);
  if (dashboardAuthenticated) loadEvents().catch(console.error);
}, 3000);
setInterval(() => {
  if (dashboardAuthenticated) loadTelemetry().catch(console.error);
}, 5000);
