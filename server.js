const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' })); // Permite payloads grandes do C#

// Serve os ficheiros estáticos (Dashboard HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// Estado em memória (Ponte)
let latestPayload = {
    snapshot: {},
    telemetry: { groups: [] },
    liveControl: {},
    history: { items: [], cards: [] }
};
let pendingCommands = [];

// ============================================================================
// 1. ENDPOINTS PARA O AGENTE C# (PUSH E POLLING)
// ============================================================================

// C# envia telemetria e o estado inteiro do sistema
app.post('/api/telemetry', (req, res) => {
    const key = req.headers['x-telemetry-key'] || req.headers['x-api-key'];
    // Verifica a chave configurada no appsettings.json do C#
    if (key !== 'rpa-gemini-2026-chave-provisoria-de-teste') {
        return res.status(401).send('Não autorizado');
    }

    const data = req.body;
    if (data) {
        if (data.snapshot) latestPayload.snapshot = data.snapshot;
        if (data.telemetry) latestPayload.telemetry = data.telemetry;
        if (data.liveControl) latestPayload.liveControl = data.liveControl;
        if (data.history) latestPayload.history = data.history;
    }
    res.sendStatus(200);
});

// C# pergunta se há novos comandos pendentes
app.get('/api/commands', (req, res) => {
    res.json(pendingCommands);
});

// C# confirma que executou o comando
app.post('/api/commands/:id/ack', (req, res) => {
    const commandId = req.params.id;
    // Remove o comando da fila de pendentes
    pendingCommands = pendingCommands.filter(c => String(c.id) !== commandId);
    res.sendStatus(200);
});

// C# envia sincronização de histórico SQL (opcional, só recebemos e damos 200 OK)
app.post('/api/history/sync', (req, res) => res.sendStatus(200));

// ============================================================================
// 2. ENDPOINTS PARA O FRONTEND DASHBOARD (JS)
// ============================================================================

app.get('/api/dashboard/snapshot', (req, res) => res.json(latestPayload.snapshot));
app.get('/api/dashboard/telemetry', (req, res) => res.json(latestPayload.telemetry));
app.get('/api/dashboard/history', (req, res) => res.json(latestPayload.history));
app.get('/api/live-control/state', (req, res) => res.json(latestPayload.liveControl));

// Frontend envia um comando (Exige a senha "Zeux")
app.post('/api/live-control/command', (req, res) => {
    const key = req.headers['x-api-key'];
    
    if (key !== 'Zeux') {
        return res.status(401).json({ ok: false, message: 'Senha inválida. Comando recusado.' });
    }

    const { command, payload } = req.body;
    const newCommand = {
        id: Date.now().toString(), // ID único para o comando
        command: command,
        payload: payload || {}
    };

    pendingCommands.push(newCommand);
    res.json({ ok: true, message: 'Comando enviado e a aguardar leitura do Agente.' });
});

// Redirecionar tudo o resto para o frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor ponte a correr na porta ${PORT}`));