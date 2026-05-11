'use strict';

const $ = (id) => document.getElementById(id);

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function numberValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function percent(value) {
  return `${numberValue(value).toFixed(1)}%`;
}

function updateCard(id, value) {
  const element = $(id);
  if (element) element.textContent = String(valueOrDash(value));
}

function updateDashboard(data) {
  const latest = data.latest;
  if (!latest) {
    $('connectionStatus').textContent = 'Sem telemetria';
    $('connectionStatus').className = 'status-pill warn';
    return;
  }

  $('connectionStatus').textContent = 'Online';
  $('connectionStatus').className = 'status-pill ok';

  updateCard('estado', latest.estado);
  updateCard('instanceName', latest.instanceName);
  updateCard('idExecucao', latest.idExecucao);
  updateCard('campoAtual', latest.campoAtual);
  updateCard('ficheiroAtual', `${latest.ficheiroAtualIndice ?? '-'} / ${latest.ficheiroAtualTotal ?? '-'}`);
  updateCard('receivedAt', latest.receivedAt ? new Date(latest.receivedAt).toLocaleString('pt-PT') : '-');
  updateCard('ultimoEvento', latest.ultimoEvento);

  const progresso = Math.max(0, Math.min(100, numberValue(latest.progressoPercentual)));
  $('progressoLabel').textContent = percent(progresso);
  $('progressoBar').style.width = `${progresso}%`;

  updateCard('cifsRecebidos', latest.cifsRecebidos);
  updateCard('cifsProcessados', latest.cifsProcessados);
  updateCard('cifsSucesso', latest.cifsSucesso);
  updateCard('sucessoPercentual', percent(latest.sucessoPercentual));
  updateCard('cifsNaoEncontrado', latest.cifsNaoEncontrado);
  updateCard('cifsInvalidos', latest.cifsInvalidos);
  updateCard('cifsComErro', latest.cifsComErro);
  updateCard('ficheirosNaFila', latest.ficheirosNaFila);
  updateCard('ficheirosAvaliados', latest.ficheirosAvaliados);
  updateCard('ficheirosFtp550', latest.ficheirosFtp550);
  updateCard('requestsGemini', latest.requestsGemini);
  updateCard('timeoutsAgente', latest.timeoutsAgente);
  updateCard('errosApi', latest.errosApi);
}

function updateHistory(items) {
  const body = $('historyBody');
  if (!items || !items.length) {
    body.innerHTML = '<tr><td colspan="7">Sem dados ainda.</td></tr>';
    return;
  }

  body.innerHTML = items.slice(0, 30).map(item => `
    <tr>
      <td>${item.receivedAt ? new Date(item.receivedAt).toLocaleString('pt-PT') : '-'}</td>
      <td>${valueOrDash(item.estado)}</td>
      <td>${percent(item.progressoPercentual)}</td>
      <td>${valueOrDash(item.cifsProcessados)}</td>
      <td>${valueOrDash(item.cifsSucesso)} (${percent(item.sucessoPercentual)})</td>
      <td>${valueOrDash(item.cifsNaoEncontrado)}</td>
      <td>${valueOrDash(item.errosApi)}</td>
    </tr>
  `).join('');
}

async function refresh() {
  try {
    const [stateRes, historyRes] = await Promise.all([
      fetch('/api/state', { cache: 'no-store' }),
      fetch('/api/history?limit=50', { cache: 'no-store' })
    ]);

    if (!stateRes.ok || !historyRes.ok) throw new Error('Falha HTTP');

    const state = await stateRes.json();
    const history = await historyRes.json();

    updateDashboard(state);
    updateHistory(history.items || []);
  } catch (err) {
    $('connectionStatus').textContent = 'Erro de ligação';
    $('connectionStatus').className = 'status-pill danger';
  }
}

refresh();
setInterval(refresh, 5000);
