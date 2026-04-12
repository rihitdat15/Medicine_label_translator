'use strict';

const config = require('../config');
const { AuthError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * API Key middleware.
 *
 * Reads the key from the configured header (default: x-api-key).
 * If ALLOWED_API_KEYS is empty, the middleware is skipped (useful for local dev).
 * In production, always set at least one key.
 *
 * Usage in routes:
 *   router.post('/translate', apiKeyAuth, upload.single('image'), handler);
 */
function apiKeyAuth(req, res, next) {
  const { allowedApiKeys, apiKeyHeader } = config.security;

  // Skip auth if no keys are configured (dev convenience — warn loudly)
  if (!allowedApiKeys.length) {
    if (config.server.env === 'production') {
      logger.error('API key auth disabled in PRODUCTION — this is a security risk!');
    }
    return next();
  }

  const providedKey = req.headers[apiKeyHeader];

  if (!providedKey) {
    logger.warn('Request missing API key header', {
      ip: req.ip,
      path: req.path,
      header: apiKeyHeader,
    });
    return next(new AuthError(`Missing API key. Provide it in the '${apiKeyHeader}' header.`));
  }

  if (!allowedApiKeys.includes(providedKey)) {
    logger.warn('Request with invalid API key', { ip: req.ip, path: req.path });
    return next(new AuthError('Invalid API key.'));
  }

  next();
}

module.exports = { apiKeyAuth };
