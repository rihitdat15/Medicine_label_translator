'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createApp } = require('./app');
const logger = require('./utils/logger');

// ── Ensure upload/log directories exist ────────────────────────────────────────
[config.upload.tempDir, config.logging.dir].forEach((dir) => {
  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
    logger.info(`Created directory: ${absDir}`);
  }
});

// ── Start Server ───────────────────────────────────────────────────────────────
const app = createApp();

const server = app.listen(config.server.port, () => {
  logger.info('Medicine Label Translator API started', {
    port: config.server.port,
    env: config.server.env,
    apiVersion: config.server.apiVersion,
    openaiModel: config.openai.model,
    mlkitPassthrough: config.mlkit.passthroughEnabled,
  });
});

// ── Graceful Shutdown ──────────────────────────────────────────────────────────
// On SIGTERM (Docker stop / k8s pod termination), finish in-flight requests
// before closing. This prevents 502s during rolling deploys.

const SHUTDOWN_GRACE_MS = parseInt(process.env.SHUTDOWN_GRACE_MS, 10) || 10_000;

function gracefulShutdown(signal) {
  logger.info(`${signal} received — starting graceful shutdown`);

  server.close((err) => {
    if (err) {
      logger.error('Error during server close', { error: err.message });
      process.exit(1);
    }
    logger.info('Server closed cleanly');
    process.exit(0);
  });

  // Force-exit if shutdown takes too long
  setTimeout(() => {
    logger.error(`Graceful shutdown timed out after ${SHUTDOWN_GRACE_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Surface unhandled rejections before Winston can catch them
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
});

module.exports = server; // exported for supertest
