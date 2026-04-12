'use strict';

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { UnsupportedMediaError, ValidationError } = require('../utils/errors');

/**
 * Multer storage — writes to temp dir with UUID filenames to prevent collisions.
 * In production you'd swap diskStorage for a GCS/S3 streaming storage engine.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.upload.tempDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

/**
 * MIME type filter — rejects non-image uploads before they hit the disk.
 */
function fileFilter(req, file, cb) {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new UnsupportedMediaError(file.mimetype));
  }
}

/**
 * Configured multer instance.
 * Routes use: upload.single('image')
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxSizeBytes,
    files: 1,
  },
});

/**
 * Wraps multer to convert its errors into our ApiError format.
 * Multer throws its own error types that our global handler doesn't know about.
 */
function handleUploadErrors(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (!err) return next();

      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ValidationError(
            `File too large. Maximum allowed: ${config.upload.maxSizeBytes / 1024 / 1024}MB`
          )
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ValidationError('Unexpected field. Use "image" as the file field name.'));
      }
      // Pass through UnsupportedMediaError and anything else
      next(err);
    });
  };
}

module.exports = { upload, handleUploadErrors };
