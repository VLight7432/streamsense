// backend/src/authMiddleware.js
const { validateApiKey } = require('./connectors/licenseClient');

async function licenseMiddleware(req, res, next) {
  const apiKey = req.headers['x-streamsense-license'] || req.headers['x-streamsense-apikey'];
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

  // OVERRIDE DEV/BÊTA : forcer un plan LIFETIME pour une clé de test donnée
  if (!isProd && apiKey === 'L49A-9M98-02W1-BL7X') {
    req.license = {
      valid: true,
      plan: 'lifetime',      // ici on teste LIFETIME
      email: 'test@stream-sense.org',
      features: { beta: true },
      reason: null,
    };
    return next();
  }

  try {
    const license = await validateApiKey(apiKey);

    if (!license.valid) {
      if (!isProd) {
        // En dev/bêta : on laisse passer mais on marque la licence comme free
        req.license = {
          valid: false,
          plan: 'free',
          email: null,
          features: {},
          reason: license.reason || 'invalid',
        };
        return next();
      }
      return res.status(402).json({ error: 'license_invalid', reason: license.reason || 'invalid' });
    }

    // Licence valide (retour réel du service stream-sense.org)
    req.license = license;
    return next();
  } catch (e) {
    if (!isProd) {
      req.license = {
        valid: false,
        plan: 'free',
        email: null,
        features: {},
        reason: 'license_service_error',
      };
      return next();
    }
    return res.status(502).json({ error: 'license_service_error' });
  }
}

module.exports = { licenseMiddleware };