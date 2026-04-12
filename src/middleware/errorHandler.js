'use strict';

const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Global Express error handler.
 * Must be registered LAST, after all routes.
 *
 * Normalises all errors into a consistent JSON envelope:
 * {
 *   "success": false,
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "...",
 *     "details": [...],   // optional
 *     "requestId": "..."
 *   }
 * }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';
  const log = logger.forRequest(requestId);

  // Determine status and code
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';
  const isOperational = err instanceof ApiError;

  // Log at appropriate level
  if (statusCode >= 500) {
    log.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      code: errorCode,
      path: req.path,
      method: req.method,
    });
  } else {
    log.warn('Client error', {
      error: err.message,
      code: errorCode,
      path: req.path,
      method: req.method,
    });
  }

  // Build response body
  const body = {
    success: false,
    error: {
      code: errorCode,
      message: isOperational || config.server.isDev ? err.message : 'An unexpected error occurred',
      requestId,
      ...(err.meta?.details ? { details: err.meta.details } : {}),
      // Only expose stack traces in development
      ...(config.server.isDev && !isOperational ? { stack: err.stack } : {}),
    },
  };

  res.status(statusCode).json(body);
}

/**
 * 404 handler ��� catches requests that fell through all routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
      requestId: req.id,
    },
  });
}

module.exports = { errorHandler, notFoundHandler };
