module.exports = function validateControlPassword(req, res, next) {
  const provided = req.headers['x-live-control-password'];

  if (!provided) {
    return res.status(401).json({
      ok: false,
      message: 'Password requerida'
    });
  }

  if (provided !== process.env.LIVE_CONTROL_PASSWORD) {
    return res.status(403).json({
      ok: false,
      message: 'Password inválida'
    });
  }

  next();
};
