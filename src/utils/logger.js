'use strict';

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const config = require('../config');
const path = require('path');

const { combine, timestamp, printf, colorize, errors, json } = format;

// Human-readable format for development consoles
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, requestId, stack }) => {
    const rid = requestId ? ` [${requestId}]` : '';
    return `${ts} ${level}${rid}: ${stack || message}`;
  })
);

// Structured JSON for log aggregation in production (Datadog, Cloud Logging, etc.)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: config.logging.level,
  format: config.server.isDev ? devFormat : prodFormat,
  transports: [
    new transports.Console(),

    // Rotating error log
    new transports.DailyRotateFile({
      level: 'error',
      dirname: config.logging.dir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // Rotating combined log
    new transports.DailyRotateFile({
      dirname: config.logging.dir,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
  exceptionHandlers: [
    new transports.File({
      filename: path.join(config.logging.dir, 'exceptions.log'),
    }),
  ],
  rejectionHandlers: [
    new transports.File({
      filename: path.join(config.logging.dir, 'rejections.log'),
    }),
  ],
});

/**
 * Returns a child logger pre-tagged with a request ID for per-request tracing.
 * @param {string} requestId
 */
logger.forRequest = (requestId) => logger.child({ requestId });

module.exports = logger;
