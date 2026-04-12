'use strict';

const sharp = require('sharp');
const logger = require('./logger');

/**
 * Preprocesses a medicine label image for optimal OCR accuracy:
 *  - Converts to greyscale (reduces colour noise on label backgrounds)
 *  - Applies mild sharpening to improve character edges
 *  - Normalises contrast
 *  - Outputs as high-quality JPEG buffer
 *
 * @param {Buffer} inputBuffer  Raw image buffer from multer
 * @returns {Promise<Buffer>}   Processed image buffer (JPEG)
 */
async function preprocessImageForOCR(inputBuffer) {
  try {
    const processed = await sharp(inputBuffer)
      .rotate()                      // auto-rotate from EXIF (handles phone orientation)
      .resize({
        width: 2048,                 // cap resolution — Vision API works best ≤4MP
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .greyscale()                   // greyscale dramatically improves OCR on coloured labels
      .normalize()                   // stretch contrast across full range
      .sharpen({ sigma: 1.5 })       // sharpen text edges
      .jpeg({ quality: 92 })
      .toBuffer();

    logger.debug(`Image preprocessed: ${inputBuffer.length} → ${processed.length} bytes`);
    return processed;
  } catch (err) {
    logger.warn('Image preprocessing failed, using raw buffer', { error: err.message });
    // Fall through to raw buffer — Vision API can still handle most inputs
    return inputBuffer;
  }
}

/**
 * Converts an image buffer to a base64 string suitable for API payloads.
 * @param {Buffer} buffer
 * @returns {string}
 */
function toBase64(buffer) {
  return buffer.toString('base64');
}

/**
 * Returns the MIME type of a Sharp-processed buffer (always jpeg after our pipeline).
 * @param {string} originalMime
 * @returns {string}
 */
function resolveOutputMime(originalMime) {
  // After preprocessing we always output JPEG
  return 'image/jpeg';
}

module.exports = { preprocessImageForOCR, toBase64, resolveOutputMime };
