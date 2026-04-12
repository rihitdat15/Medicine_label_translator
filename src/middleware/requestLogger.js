'use strict';

const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const logger = require('../utils/logger');

/**
 * Attaches a unique request ID to every request.
 * The ID is propagated in:
 *  - req.id        (accessible in route handlers)
 *  - res header    X-Request-Id (returned to clients for support tickets)
 */
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * HTTP access log stream that pipes morgan into Winston.
 */
const morganStream = {
  write: (message) => logger.http(message.trim()),
};

/**
 * Morgan HTTP access logger.
 * Uses 'combined' format in production, 'dev' in development.
 */
function httpLogger(env) {
  return morgan(env === 'production' ? 'combined' : 'dev', {
    stream: morganStream,
  });
}

module.exports = { requestId, httpLogger };
