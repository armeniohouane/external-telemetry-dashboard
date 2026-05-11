# External Telemetry Dashboard

Dashboard externo simples para receber telemetria sanitizada do RPA Clientes Irregulares Gemini.

## O que ele recebe

Endpoint:

```http
POST /api/telemetry
X-Telemetry-Key: SUA_CHAVE
Content-Type: application/json
```

A API rejeita campos sensíveis óbvios como `cif`, `caminho`, `fileName`, `prompt`, `rawResponse` e `logs`.

## Rodar localmente

```powershell
setx TELEMETRY_KEY "troque-por-uma-chave-forte-com-32-caracteres"
$env:TELEMETRY_KEY="troque-por-uma-chave-forte-com-32-caracteres"
node server.js
```

Abrir:

```text
http://localhost:8080
```

## Teste manual com curl

```bash
curl -X POST http://localhost:8080/api/telemetry \
  -H "Content-Type: application/json" \
  -H "X-Telemetry-Key: troque-por-uma-chave-forte-com-32-caracteres" \
  -d '{"instanceName":"RPA Clientes Irregulares - DEV","estado":"Em Execucao","cifsRecebidos":999,"cifsProcessados":12,"cifsSucesso":2,"cifsNaoEncontrado":8,"cifsInvalidos":1,"cifsComErro":1,"ficheirosNaFila":400,"ficheirosAvaliados":27,"requestsGemini":20,"timeoutsAgente":0,"errosApi":3,"progressoPercentual":1.2,"sucessoPercentual":16.7,"ultimoEvento":"Processamento em curso"}'
```

## Variáveis de ambiente

| Variável | Exemplo | Descrição |
|---|---|---|
| `PORT` | `8080` | Porta HTTP do dashboard externo |
| `TELEMETRY_KEY` | `valor-longo-secreto` | Chave que o agente local deve enviar no header `X-Telemetry-Key` |
| `MAX_HISTORY` | `500` | Quantidade máxima de pontos de telemetria mantidos em memória |
| `MAX_BODY_BYTES` | `262144` | Tamanho máximo do payload POST |
| `DATA_DIR` | `./data` | Pasta onde o histórico JSONL é guardado |
