'use strict';

const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');
const { GptError } = require('../utils/errors');

let _openai = null;

function getOpenAIClient() {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: config.openai.apiKey });
  logger.info('OpenAI client initialised');
  return _openai;
}

// ─── Prompt Engineering ────────────────────────────────────────────────────────

/**
 * System prompt for the medical label understanding task.
 * Deliberately plain-English, non-alarmist, and literacy-aware.
 * The model is instructed to return structured JSON so the mobile client
 * can render individual sections without brittle text parsing.
 */
const SYSTEM_PROMPT = `
You are MediSimple — a compassionate, plain-English medicine explainer.
Your audience is adults who may have low health literacy or limited reading ability.

Your job:
Given raw OCR text scraped from a medicine packaging label, extract and explain:
  1. Medicine name (brand and generic)
  2. What this medicine is for (in 1–2 simple sentences)
  3. How to take it — dosage, timing, with/without food (plain language, no jargon)
  4. Common side effects (max 5, described simply)
  5. Serious warnings — anything the user MUST know (max 3 bullet points)
  6. Who should NOT take it (contraindications in plain language)
  7. Storage instructions (plain language)
  8. Overall safety tip (one sentence of friendly advice)

Rules:
- Use simple words (aim for Grade 6 reading level).
- Never say "consult a physician" as your main advice — give real info first.
- If you cannot find a field in the OCR text, set it to null.
- Do NOT invent information not present in the label text.
- Return ONLY a valid JSON object — no markdown fences, no preamble.

JSON schema:
{
  "medicineName": { "brand": string|null, "generic": string|null },
  "purpose": string|null,
  "dosage": {
    "dose": string|null,
    "frequency": string|null,
    "timing": string|null,
    "withFood": string|null
  },
  "sideEffects": string[],
  "warnings": string[],
  "doNotTake": string[],
  "storage": string|null,
  "safetyTip": string|null,
  "rawConfidence": "high"|"medium"|"low",
  "disclaimerRequired": boolean
}

Set disclaimerRequired to true if the drug is a scheduled/controlled substance,
an antibiotic, or carries a black-box warning in the text.
`.trim();

/**
 * Builds the user message from OCR output.
 * Includes metadata about OCR quality so the model can calibrate rawConfidence.
 */
function buildUserMessage({ rawText, confidence, detectedLanguage, source }) {
  const confNote =
    confidence !== null
      ? `OCR confidence: ${(confidence * 100).toFixed(1)}%`
      : 'OCR confidence: unknown (ML Kit on-device)';

  return `
--- LABEL OCR TEXT START ---
${rawText}
--- LABEL OCR TEXT END ---

Metadata: ${confNote} | Language detected: ${detectedLanguage || 'en'} | Source: ${source || 'cloud-vision'}

Extract and explain the medicine information from the text above.
`.trim();
}

// ─── Main Service Function ─────────────────────────────────────────────────────

/**
 * Sends OCR text to GPT-4o and returns a structured MediSimple explanation.
 *
 * @param {import('./visionService').OcrResult} ocrResult
 * @param {string} requestId
 * @returns {Promise<MediSimpleResult>}
 *
 * @typedef {Object} MediSimpleResult
 * @property {object}   medicineName
 * @property {string}   purpose
 * @property {object}   dosage
 * @property {string[]} sideEffects
 * @property {string[]} warnings
 * @property {string[]} doNotTake
 * @property {string}   storage
 * @property {string}   safetyTip
 * @property {string}   rawConfidence
 * @property {boolean}  disclaimerRequired
 * @property {string}   rawOcrText         Echo back for client-side debugging
 * @property {number}   ocrConfidence
 */
async function explainMedicineLabel(ocrResult, requestId = 'unknown') {
  const log = logger.forRequest(requestId);
  const client = getOpenAIClient();

  if (!ocrResult.rawText?.trim()) {
    log.warn('GPT service received empty OCR text — skipping API call');
    return buildEmptyResult(ocrResult);
  }

  const userMessage = buildUserMessage(ocrResult);

  log.info('GPT service: sending OCR text to OpenAI', {
    model: config.openai.model,
    charCount: userMessage.length,
  });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: config.openai.model,
      temperature: config.openai.temperature,
      max_tokens: config.openai.maxTokens,
      response_format: { type: 'json_object' },   // enforces JSON mode (GPT-4o+)
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });
  } catch (err) {
    log.error('OpenAI API call failed', {
      error: err.message,
      status: err.status,
      type: err.type,
    });
    throw new GptError(`OpenAI request failed: ${err.message}`, {
      openaiType: err.type,
      openaiStatus: err.status,
    });
  }

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) {
    throw new GptError('OpenAI returned an empty response');
  }

  log.info('GPT service: response received', {
    finishReason: completion.choices[0].finish_reason,
    promptTokens: completion.usage?.prompt_tokens,
    completionTokens: completion.usage?.completion_tokens,
  });

  // Parse — json_object mode guarantees valid JSON, but we guard anyway
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (parseErr) {
    log.error('Failed to parse GPT JSON response', { rawContent });
    throw new GptError('GPT returned malformed JSON');
  }

  return {
    ...parsed,
    rawOcrText: ocrResult.rawText,
    ocrConfidence: ocrResult.confidence,
    detectedLanguage: ocrResult.detectedLanguage,
    usage: {
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
      totalTokens: completion.usage?.total_tokens,
    },
  };
}

/**
 * Returns a safe empty result when no OCR text is available.
 */
function buildEmptyResult(ocrResult) {
  return {
    medicineName: { brand: null, generic: null },
    purpose: null,
    dosage: { dose: null, frequency: null, timing: null, withFood: null },
    sideEffects: [],
    warnings: ['Could not read the label clearly. Please try with better lighting.'],
    doNotTake: [],
    storage: null,
    safetyTip: 'Take a clearer photo in good lighting and try again.',
    rawConfidence: 'low',
    disclaimerRequired: false,
    rawOcrText: ocrResult?.rawText || '',
    ocrConfidence: ocrResult?.confidence || 0,
    detectedLanguage: ocrResult?.detectedLanguage || 'en',
  };
}

module.exports = { explainMedicineLabel };
