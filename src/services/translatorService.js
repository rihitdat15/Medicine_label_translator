'use strict';

const { preprocessImageForOCR } = require('../utils/imageProcessor');
const { extractTextFromImage, processMLKitText } = require('./visionService');
const { explainMedicineLabel } = require('./gptService');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Orchestrates the full medicine label translation pipeline:
 *
 *   [Image Buffer | MLKit Text]
 *           ↓
 *   Image Preprocessing (Sharp)
 *           ↓
 *   OCR  ← Cloud Vision API  OR  ML Kit passthrough
 *           ↓
 *   Medical NLU ← OpenAI GPT-4o
 *           ↓
 *   Structured plain-English response
 *
 * @param {TranslateOptions} options
 * @returns {Promise<TranslateResult>}
 *
 * @typedef {Object} TranslateOptions
 * @property {Buffer}  [imageBuffer]     Raw image buffer (mutually exclusive with mlkitText)
 * @property {string}  [mlkitText]       Pre-extracted text from Google ML Kit (mobile)
 * @property {string}  requestId         Unique request ID for log correlation
 * @property {string}  [imageMimeType]   MIME type of the uploaded image
 *
 * @typedef {Object} TranslateResult
 * @property {boolean} success
 * @property {string}  requestId
 * @property {string}  pipeline          'cloud-vision' | 'mlkit-passthrough'
 * @property {object}  explanation       Structured MediSimple result from GPT
 * @property {object}  meta              Timing and diagnostic metadata
 */
async function translateLabel(options) {
  const { imageBuffer, mlkitText, requestId, imageMimeType } = options;
  const log = logger.forRequest(requestId);

  const timings = {};
  const overallStart = Date.now();

  // ── Step 1: OCR ──────────────────────────────────────────────────────────────
  let ocrResult;
  let pipeline;

  if (config.mlkit.passthroughEnabled && mlkitText) {
    // Path A: Mobile app already ran Google ML Kit on-device — skip Vision API
    pipeline = 'mlkit-passthrough';
    log.info('Pipeline: ML Kit passthrough (no Vision API call needed)');
    ocrResult = processMLKitText(mlkitText, requestId);

  } else if (imageBuffer) {
    // Path B: Raw image — preprocess and call Cloud Vision
    pipeline = 'cloud-vision';
    log.info('Pipeline: Cloud Vision OCR');

    const preprocessStart = Date.now();
    const processedImage = await preprocessImageForOCR(imageBuffer);
    timings.preprocessMs = Date.now() - preprocessStart;

    const ocrStart = Date.now();
    ocrResult = await extractTextFromImage(processedImage, requestId);
    timings.ocrMs = Date.now() - ocrStart;

  } else {
    throw new Error('translateLabel requires either imageBuffer or mlkitText');
  }

  // ── Step 2: GPT Medical Understanding ────────────────────────────────────────
  const gptStart = Date.now();
  const explanation = await explainMedicineLabel(ocrResult, requestId);
  timings.gptMs = Date.now() - gptStart;

  timings.totalMs = Date.now() - overallStart;

  log.info('Translation pipeline complete', { pipeline, timings });

  return {
    success: true,
    requestId,
    pipeline,
    explanation,
    meta: {
      timings,
      ocrCharCount: ocrResult.rawText.length,
      ocrConfidence: ocrResult.confidence,
      detectedLanguage: ocrResult.detectedLanguage,
      gptModel: config.openai.model,
      gptUsage: explanation.usage,
    },
  };
}

module.exports = { translateLabel };
