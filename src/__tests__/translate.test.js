'use strict';

/**
 * Integration tests for the /api/v1/translate routes.
 *
 * These tests mock the Cloud Vision and OpenAI SDK calls so they run
 * without real API credentials. Useful for CI pipelines.
 *
 * Run:  npm test
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('@google-cloud/vision', () => {
  return {
    ImageAnnotatorClient: jest.fn().mockImplementation(() => ({
      documentTextDetection: jest.fn().mockResolvedValue([
        {
          fullTextAnnotation: {
            text: 'Paracetamol 500mg Tablets\nDosage: 1-2 tablets every 4-6 hours\nMax 8 tablets in 24 hours\nSide effects: nausea, rash\nDo not exceed stated dose',
            pages: [
              {
                blocks: [],
                property: { detectedLanguages: [{ languageCode: 'en' }] },
              },
            ],
          },
          error: null,
        },
      ]),
    })),
  };
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  medicineName: { brand: null, generic: 'Paracetamol' },
                  purpose: 'Relieves pain and reduces fever.',
                  dosage: {
                    dose: '1-2 tablets',
                    frequency: 'Every 4-6 hours',
                    timing: 'As needed',
                    withFood: null,
                  },
                  sideEffects: ['Feeling sick (nausea)', 'Skin rash'],
                  warnings: ['Do not take more than 8 tablets in 24 hours'],
                  doNotTake: [],
                  storage: null,
                  safetyTip: 'Keep out of reach of children.',
                  rawConfidence: 'high',
                  disclaimerRequired: false,
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
        }),
      },
    },
  }));
});

// ── Test Setup ─────────────────────────────────────────────────────────────────

// Set env vars BEFORE requiring the app so config picks them up
process.env.OPENAI_API_KEY = 'sk-test';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_API_KEYS = 'test-key-123';
process.env.UPLOAD_TEMP_DIR = '/tmp/mlt-test-uploads';
process.env.LOG_DIR = '/tmp/mlt-test-logs';

// Ensure temp dirs exist
['/tmp/mlt-test-uploads', '/tmp/mlt-test-logs'].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const { createApp } = require('../src/app');
const app = createApp();

const TEST_API_KEY = 'test-key-123';
const AUTH_HEADERS = { 'x-api-key': TEST_API_KEY };

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready returns ready status', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});

describe('POST /api/v1/translate/mlkit', () => {
  const endpoint = '/api/v1/translate/mlkit';
  const validPayload = {
    text: 'Paracetamol 500mg - take 1-2 tablets every 4-6 hours. Do not exceed 8 tablets in 24 hours.',
  };

  it('rejects request without API key', async () => {
    const res = await request(app).post(endpoint).send(validPayload);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid API key', async () => {
    const res = await request(app)
      .post(endpoint)
      .set('x-api-key', 'wrong-key')
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  it('rejects missing text field', async () => {
    const res = await request(app)
      .post(endpoint)
      .set(AUTH_HEADERS)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects text that is too short', async () => {
    const res = await request(app)
      .post(endpoint)
      .set(AUTH_HEADERS)
      .send({ text: 'ab' });
    expect(res.status).toBe(422);
  });

  it('returns successful translation for valid ML Kit text', async () => {
    const res = await request(app)
      .post(endpoint)
      .set(AUTH_HEADERS)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pipeline).toBe('mlkit-passthrough');
    expect(res.body.explanation).toBeDefined();
    expect(res.body.explanation.medicineName).toBeDefined();
    expect(res.body.explanation.dosage).toBeDefined();
    expect(Array.isArray(res.body.explanation.sideEffects)).toBe(true);
  });

  it('includes X-Request-Id header in response', async () => {
    const res = await request(app)
      .post(endpoint)
      .set(AUTH_HEADERS)
      .send(validPayload);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('respects X-Request-Id header from client', async () => {
    const clientId = 'my-custom-id-123';
    const res = await request(app)
      .post(endpoint)
      .set({ ...AUTH_HEADERS, 'x-request-id': clientId })
      .send(validPayload);
    expect(res.headers['x-request-id']).toBe(clientId);
  });
});

describe('POST /api/v1/translate/base64', () => {
  const endpoint = '/api/v1/translate/base64';

  it('rejects missing image field', async () => {
    const res = await request(app)
      .post(endpoint)
      .set(AUTH_HEADERS)
      .send({ mime: 'image/jpeg' });
    expect(res.status).toBe(422);
  });

  it('rejects invalid mime type', async () => {
    const res = await request(app)
      .post(endpoint)
      .set(AUTH_HEADERS)
      .send({ image: Buffer.alloc(200).toString('base64'), mime: 'application/pdf' });
    expect(res.status).toBe(422);
  });
});

describe('Unknown routes', () => {
  it('returns 404 for unknown path', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
