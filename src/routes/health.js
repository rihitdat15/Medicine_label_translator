'use strict';

const express = require('express');
const os = require('os');
const config = require('../config');

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Liveness probe — returns 200 if the process is running
 * @access  Public
 */
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

/**
 * @route   GET /health/ready
 * @desc    Readiness probe — checks that external dependencies are reachable.
 *          Kubernetes/Cloud Run will not route traffic until this returns 200.
 * @access  Public
 */
router.get('/ready', async (req, res) => {
  const checks = {
    openai: !!config.openai.apiKey,
    gcpCredentials: !!(config.gcp.credentialsFile || config.gcp.credentialsBase64 || true), // ADC fallback
    mlkitPassthrough: config.mlkit.passthroughEnabled,
  };

  const allPassed = Object.values(checks).every(Boolean);

  res.status(allPassed ? 200 : 503).json({
    status: allPassed ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   GET /health/info
 * @desc    System info — useful during incident response.
 *          Only exposed in non-production or to internal networks.
 * @access  Restricted (dev/internal)
 */
router.get('/info', (req, res) => {
  if (config.server.env === 'production') {
    return res.status(404).json({ status: 'not found' });
  }

  res.status(200).json({
    status: 'ok',
    process: {
      nodeVersion: process.version,
      uptime: process.uptime(),
      memoryMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      pid: process.pid,
    },
    system: {
      platform: os.platform(),
      cpus: os.cpus().length,
      freeMemoryMB: (os.freemem() / 1024 / 1024).toFixed(2),
    },
    config: {
      env: config.server.env,
      apiVersion: config.server.apiVersion,
      openaiModel: config.openai.model,
      mlkitPassthrough: config.mlkit.passthroughEnabled,
      storageBackend: config.upload.storageBackend,
    },
  });
});

module.exports = router;
