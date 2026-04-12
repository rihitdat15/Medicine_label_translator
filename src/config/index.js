'use strict';

require('dotenv').config();

/**
 * Centralised configuration module.
 * Validates required env vars at startup so the process fails fast
 * instead of crashing mid-request in production.
 */

const REQUIRED_VARS = [
  'OPENAI_API_KEY',
];

const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[Config] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    apiVersion: process.env.API_VERSION || 'v1',
    isDev: (process.env.NODE_ENV || 'development') === 'development',
  },

  security: {
    apiKeyHeader: process.env.API_KEY_HEADER || 'x-api-key',
    allowedApiKeys: (process.env.ALLOWED_API_KEYS || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    jwtSecret: process.env.JWT_SECRET,
  },

  gcp: {
    projectId: process.env.GCP_PROJECT_ID,
    credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    credentialsBase64: process.env.GOOGLE_CREDENTIALS_BASE64,
    visionLocation: process.env.VISION_API_LOCATION || 'us-east1',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 1200,
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.2,
  },

  mlkit: {
    passthroughEnabled: process.env.MLKIT_PASSTHROUGH_ENABLED === 'true',
  },

  upload: {
    maxSizeBytes: (parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 10) * 1024 * 1024,
    allowedMimeTypes: (
      process.env.UPLOAD_ALLOWED_MIMETYPES ||
      'image/jpeg,image/png,image/webp,image/heic'
    )
      .split(',')
      .map((m) => m.trim()),
    tempDir: process.env.UPLOAD_TEMP_DIR || './uploads',
    storageBackend: process.env.STORAGE_BACKEND || 'local',
    gcsBucket: process.env.GCS_BUCKET_NAME,
    gcsSignedUrlExpiry: parseInt(process.env.GCS_SIGNED_URL_EXPIRY_MINUTES, 10) || 60,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 30,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};

module.exports = config;
