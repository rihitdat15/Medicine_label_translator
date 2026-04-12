'use strict';

const vision = require('@google-cloud/vision');
const config = require('../config');
const logger = require('../utils/logger');
const { OcrError } = require('../utils/errors');

/**
 * Lazily initialised Vision client.
 * Supports both file-based credentials and base64-encoded credentials
 * (useful for containerised/serverless deployments where mounting files is inconvenient).
 */
let _client = null;

function getVisionClient() {
  if (_client) return _client;

  const clientOptions = { projectId: config.gcp.projectId };

  if (config.gcp.credentialsBase64) {
    // Decode inline credentials — ideal for 12-factor / container deployments
    const credentials = JSON.parse(
      Buffer.from(config.gcp.credentialsBase64, 'base64').toString('utf-8')
    );
    clientOptions.credentials = credentials;
    logger.debug('Vision client: using inline base64 credentials');
  } else if (config.gcp.credentialsFile) {
    // ADC via key file — standard local/GCE dev flow
    // GOOGLE_APPLICATION_CREDENTIALS env var is picked up automatically by the library
    logger.debug(`Vision client: using key file → ${config.gcp.credentialsFile}`);
  }
  // If neither is set, falls back to Application Default Credentials (ADC)
  // which works transparently on GKE, Cloud Run, App Engine, etc.

  _client = new vision.ImageAnnotatorClient(clientOptions);
  logger.info('Google Cloud Vision client initialised');
  return _client;
}

// ─── OCR Strategies ────────────────────────────────────────────────────────────

/**
 * Extracts text from an image buffer using Cloud Vision's DOCUMENT_TEXT_DETECTION.
 * DOCUMENT_TEXT_DETECTION is preferred over TEXT_DETECTION for dense, structured
 * label text — it uses a document layout model and returns a FullTextAnnotation
 * with paragraph / word / symbol granularity.
 *
 * @param {Buffer}  imageBuffer   Preprocessed JPEG buffer
 * @param {string}  requestId     For log correlation
 * @returns {Promise<OcrResult>}
 *
 * @typedef {Object} OcrResult
 * @property {string}   rawText         Full extracted text (newline-delimited)
 * @property {number}   confidence      Aggregate confidence score [0–1]
 * @property {Block[]}  blocks          Parsed paragraph-level blocks
 * @property {string}   detectedLanguage ISO 639-1 code of dominant language
 */
async function extractTextFromImage(imageBuffer, requestId = 'unknown') {
  const log = logger.forRequest(requestId);
  const client = getVisionClient();

  log.info('Cloud Vision OCR: starting DOCUMENT_TEXT_DETECTION');

  let response;
  try {
    [response] = await client.documentTextDetection({
      image: { content: imageBuffer },
      imageContext: {
        languageHints: ['en', 'hi', 'bn', 'ta', 'te', 'mr'], // covers common Indian scripts on labels
      },
    });
  } catch (err) {
    log.error('Cloud Vision API call failed', { error: err.message, code: err.code });
    throw new OcrError(`Vision API request failed: ${err.message}`, {
      grpcCode: err.code,
    });
  }

  // Surface Vision API-level errors (quota exceeded, permission denied, etc.)
  if (response.error?.code) {
    const { code, message } = response.error;
    log.error('Cloud Vision returned an error payload', { code, message });
    throw new OcrError(`Vision API error (${code}): ${message}`, { visionCode: code });
  }

  const fullAnnotation = response.fullTextAnnotation;
  if (!fullAnnotation || !fullAnnotation.text?.trim()) {
    log.warn('Cloud Vision: no text detected in image');
    return { rawText: '', confidence: 0, blocks: [], detectedLanguage: 'en' };
  }

  // ── Extract aggregate confidence ──────────────────────────────────────────
  const wordConfidences = [];
  const blocks = [];

  for (const page of fullAnnotation.pages || []) {
    for (const block of page.blocks || []) {
      const blockWords = [];
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const wordText = (word.symbols || []).map((s) => s.text).join('');
          const wordConf = word.confidence ?? 1;
          wordConfidences.push(wordConf);
          blockWords.push(wordText);
        }
      }
      if (blockWords.length) {
        blocks.push({
          text: blockWords.join(' '),
          confidence: block.confidence ?? null,
          blockType: block.blockType,          // TEXT | TABLE | PICTURE | RULER | BARCODE
        });
      }
    }
  }

  const avgConfidence =
    wordConfidences.length > 0
      ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
      : 0;

  // Detected language from first page context
  const detectedLanguage =
    fullAnnotation.pages?.[0]?.property?.detectedLanguages?.[0]?.languageCode || 'en';

  log.info('Cloud Vision OCR complete', {
    charCount: fullAnnotation.text.length,
    confidence: avgConfidence.toFixed(3),
    detectedLanguage,
    blockCount: blocks.length,
  });

  return {
    rawText: fullAnnotation.text.trim(),
    confidence: parseFloat(avgConfidence.toFixed(4)),
    blocks,
    detectedLanguage,
  };
}

/**
 * Accepts pre-extracted text forwarded from Google ML Kit on the mobile device.
 * ML Kit performs on-device OCR (TextRecognition API), so the server does NOT
 * need to call Vision API again — it receives the text directly.
 *
 * This function validates and normalises the payload for the downstream GPT service.
 *
 * @param {string} mlkitText    Raw text string from ML Kit TextRecognition
 * @param {string} requestId
 * @returns {OcrResult}
 */
function processMLKitText(mlkitText, requestId = 'unknown') {
  const log = logger.forRequest(requestId);

  if (!mlkitText || typeof mlkitText !== 'string') {
    throw new OcrError('ML Kit passthrough received invalid or empty text payload');
  }

  const cleaned = mlkitText.replace(/\r\n/g, '\n').trim();
  log.info('ML Kit passthrough received', { charCount: cleaned.length });

  return {
    rawText: cleaned,
    confidence: null,    // ML Kit does not expose an aggregate confidence in its public API
    blocks: [],          // Block structure not forwarded — only raw text
    detectedLanguage: 'en',
    source: 'mlkit',
  };
}

module.exports = { extractTextFromImage, processMLKitText };
