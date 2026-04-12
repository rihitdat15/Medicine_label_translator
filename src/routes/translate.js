'use strict';

const express = require('express');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const { apiKeyAuth } = require('../middleware/auth');
const { upload, handleUploadErrors } = require('../middleware/upload');
const { translateLabel } = require('../services/translatorService');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');
const config = require('../config');

const router = express.Router();

// ─── Per-route Rate Limiter ────────────────────────────────────────────────────
// The translation endpoint is compute-intensive (Vision API + GPT).
// Apply a tighter rate limit here on top of the global limiter.
const translateRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers[config.security.apiKeyHeader] || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many translation requests. Please wait before retrying.',
        requestId: req.id,
        retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
      },
    });
  },
});

// ─── Validation Rules ──────────────────────────────────────────────────────────

const mlkitTextValidation = [
  body('text')
    .isString()
    .withMessage('text must be a string')
    .isLength({ min: 5, max: 10_000 })
    .withMessage('text must be between 5 and 10,000 characters'),
];

function checkValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new ValidationError('Request validation failed', errors.array()));
  }
  next();
}

// ─── Cleanup Helper ───────────────────────────────────────────────────────────
function cleanupTempFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, (err) => {
      if (err) logger.warn('Failed to delete temp upload file', { filePath, error: err.message });
    });
  }
}

// ─── Route: POST /translate/image ─────────────────────────────────────────────
/**
 * @route   POST /api/v1/translate/image
 * @desc    Upload a medicine label image → OCR via Google Cloud Vision → GPT explanation
 * @access  API key required
 *
 * Body: multipart/form-data
 *   - image (file, required): JPEG/PNG/WebP/HEIC image of the label
 *
 * Response: TranslateResult JSON
 */
router.post(
  '/image',
  apiKeyAuth,
  translateRateLimiter,
  handleUploadErrors(upload.single('image')),
  async (req, res, next) => {
    const log = logger.forRequest(req.id);

    if (!req.file) {
      return next(new ValidationError('No image file provided. Use field name "image".'));
    }

    log.info('Translate/image request received', {
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      filename: req.file.filename,
    });

    let imageBuffer;
    try {
      imageBuffer = fs.readFileSync(req.file.path);
    } catch (err) {
      cleanupTempFile(req.file.path);
      return next(err);
    }

    try {
      const result = await translateLabel({
        imageBuffer,
        imageMimeType: req.file.mimetype,
        requestId: req.id,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    } finally {
      cleanupTempFile(req.file.path);
    }
  }
);

// ─── Route: POST /translate/mlkit ─────────────────────────────────────────────
/**
 * @route   POST /api/v1/translate/mlkit
 * @desc    Accept pre-extracted text from Google ML Kit (on-device OCR) → GPT explanation.
 *          Use this route when the mobile client runs ML Kit TextRecognition locally
 *          to save bandwidth and Vision API costs.
 * @access  API key required
 *
 * Body: application/json
 *   - text (string, required): Raw text extracted by ML Kit
 *
 * Response: TranslateResult JSON
 */
router.post(
  '/mlkit',
  apiKeyAuth,
  translateRateLimiter,
  mlkitTextValidation,
  checkValidation,
  async (req, res, next) => {
    const log = logger.forRequest(req.id);
    const { text } = req.body;

    log.info('Translate/mlkit request received', { charCount: text.length });

    try {
      const result = await translateLabel({
        mlkitText: text,
        requestId: req.id,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ─── Route: POST /translate/base64 ────────────────────────────────────────────
/**
 * @route   POST /api/v1/translate/base64
 * @desc    Accept a base64-encoded image (useful for React Native / web clients
 *          that can't do multipart easily). Runs the full Cloud Vision → GPT pipeline.
 * @access  API key required
 *
 * Body: application/json
 *   - image  (string, required): Base64-encoded image data (without data URI prefix)
 *   - mime   (string, required): MIME type e.g. "image/jpeg"
 */
router.post(
  '/base64',
  apiKeyAuth,
  translateRateLimiter,
  [
    body('image')
      .isString()
      .withMessage('image must be a base64 string')
      .isLength({ min: 100 })
      .withMessage('image payload too short'),
    body('mime')
      .isIn(config.upload.allowedMimeTypes)
      .withMessage(`mime must be one of: ${config.upload.allowedMimeTypes.join(', ')}`),
  ],
  checkValidation,
  async (req, res, next) => {
    const log = logger.forRequest(req.id);
    const { image, mime } = req.body;

    let imageBuffer;
    try {
      imageBuffer = Buffer.from(image, 'base64');
    } catch {
      return next(new ValidationError('Invalid base64 image data'));
    }

    // Enforce size limit
    if (imageBuffer.length > config.upload.maxSizeBytes) {
      return next(
        new ValidationError(
          `Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB. Max: ${config.upload.maxSizeBytes / 1024 / 1024}MB`
        )
      );
    }

    log.info('Translate/base64 request received', {
      mimeType: mime,
      sizeBytes: imageBuffer.length,
    });

    try {
      const result = await translateLabel({
        imageBuffer,
        imageMimeType: mime,
        requestId: req.id,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
