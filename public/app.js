async function loadTelemetry() {
  try {
    const response = await fetch('/api/telemetry');
    const data = await response.json();

    document.getElementById('telemetry').textContent =
      JSON.stringify(data, null, 2);
  } catch (err) {
    console.error(err);
  }
}

async function sendCommand(command, payload = {}) {
  const password = prompt('Password do Live Control');

  if (!password) {
    return;
  }

  const response = await fetch('/api/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Live-Control-Password': password
    },
    body: JSON.stringify({
      command,
      payload
    })
  });

  const data = await response.json();

  if (!data.ok) {
    alert(data.message || 'Erro');
    return;
  }

  alert('Comando enviado');
}

loadTelemetry();
setInterval(loadTelemetry, 5000);
