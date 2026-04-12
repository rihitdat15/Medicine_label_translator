'use strict';

/**
 * Base API error â€” carries HTTP status, error code, and optional metadata.
 * All domain-specific errors extend this class.
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', meta = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.meta = meta;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends ApiError {
  constructor(message, details = []) {
    super(message, 422, 'VALIDATION_ERROR', { details });
  }
}

class UnsupportedMediaError extends ApiError {
  constructor(mimeType) {
    super(`Unsupported file type: ${mimeType}`, 415, 'UNSUPPORTED_MEDIA_TYPE', { mimeType });
  }
}

class OcrError extends ApiError {
  constructor(message, meta = {}) {
    super(message, 502, 'OCR_FAILED', meta);
  }
}

class GptError extends ApiError {
  constructor(message, meta = {}) {
    super(message, 502, 'GPT_FAILED', meta);
  }
}

class RateLimitError extends ApiError {
  constructor() {
    super('Too many requests. Please slow down.', 429, 'RATE_LIMITED');
  }
}

class AuthError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class NotFoundError extends ApiError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

module.exports = {
  ApiError,
  ValidationError,
  UnsupportedMediaError,
  OcrError,
  GptError,
  RateLimitError,
  AuthError,
  NotFoundError,
};
