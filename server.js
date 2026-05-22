require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const telemetryRoutes = require('./api/telemetry');
const commandsRoutes = require('./api/commands');

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(morgan('combined'));

app.use(express.static('public'));

app.use('/api/telemetry', telemetryRoutes);
app.use('/api/commands', commandsRoutes);

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    service: 'external-telemetry-dashboard',
    utc: new Date().toISOString()
  });
});

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`Dashboard activo na porta ${port}`);
});
