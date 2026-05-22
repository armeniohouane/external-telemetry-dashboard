const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const telemetryPath = path.join(__dirname, '..', 'storage', 'telemetry.json');

router.post('/', async (req, res) => {
  try {
    const payload = {
      receivedAtUtc: new Date().toISOString(),
      data: req.body
    };

    fs.writeFileSync(
      telemetryPath,
      JSON.stringify(payload, null, 2)
    );

    return res.json({
      ok: true
    });
  }
  catch (err) {
    console.error(err);

    return res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

router.get('/', async (_, res) => {
  try {
    if (!fs.existsSync(telemetryPath)) {
      return res.json({ ok: true, data: null });
    }

    const raw = fs.readFileSync(telemetryPath, 'utf8');

    return res.json(JSON.parse(raw));
  }
  catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message
    });
  }
});

module.exports = router;
