'use strict';

require('express-async-errors'); // patches async route handlers — unhandled rejections → error handler

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const { requestId, httpLogger } = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const translateRoutes = require('./routes/translate');
const healthRoutes = require('./routes/health');

function createApp() {
  const app = express();

  // ── Security Headers ────────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────────
  // In production, restrict origins to your mobile app backend / web domain
  app.use(
    cors({
      origin: config.server.isDev ? '*' : (process.env.ALLOWED_ORIGINS || '').split(','),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', config.security.apiKeyHeader, 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    })
  );

  // ── Compression ─────────────────────────────────────────────────────────────
  app.use(compression());

  // ── Request ID + HTTP Logging ───────────────────────────────────────────────
  app.use(requestId);
  app.use(httpLogger(config.server.env));

  // ── Body Parsers ────────────────────────────────────────────────────────────
  // Note: multipart (images) is handled by multer in route middleware
  app.use(express.json({ limit: '15mb' })); // for base64 route — large payloads
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Global Rate Limiter ─────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max * 3, // global limit is 3× the per-route limit
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMITED', message: 'Slow down.' } },
    })
  );

  // ── Routes ──────────────────────────────────────────────────────────────────
  const apiBase = `/api/${config.server.apiVersion}`;

  app.use('/health', healthRoutes);
  app.use(`${apiBase}/translate`, translateRoutes);

  // ── 404 + Error Handlers ────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
