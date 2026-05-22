const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const validateControlPassword = require('../middleware/validateControlPassword');

const router = express.Router();

const commandsPath = path.join(__dirname, '..', 'storage', 'commands.json');

function readCommands() {
  if (!fs.existsSync(commandsPath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
}

function writeCommands(commands) {
  fs.writeFileSync(commandsPath, JSON.stringify(commands, null, 2));
}

router.get('/', (_, res) => {
  const commands = readCommands();

  res.json({
    ok: true,
    commands
  });
});

router.post('/', validateControlPassword, (req, res) => {
  const commands = readCommands();

  const cmd = {
    id: crypto.randomUUID(),
    command: req.body.command,
    payload: req.body.payload || {},
    createdAtUtc: new Date().toISOString(),
    applied: false
  };

  commands.push(cmd);

  writeCommands(commands);

  res.json({
    ok: true,
    command: cmd
  });
});

router.post('/:id/ack', (req, res) => {
  const commands = readCommands();

  const cmd = commands.find(x => x.id === req.params.id);

  if (cmd) {
    cmd.applied = true;
    cmd.appliedAtUtc = new Date().toISOString();
  }

  writeCommands(commands);

  res.json({ ok: true });
});

module.exports = router;
