# 💊 Medicine Label Translator — Backend

> **SI-001** · Plain-English medicine label explanations for low-literacy users.  
> Point a camera at any medicine label → get dosage, side effects, and warnings in simple language.

---

## Architecture

```
Mobile App (Android / iOS)
│
├─ Path A: On-device OCR  ──► Google ML Kit TextRecognition
│          (saves bandwidth)     │
│                                ▼
│                    POST /api/v1/translate/mlkit
│                         { text: "..." }
│
└─ Path B: Raw image  ──────► POST /api/v1/translate/image  (multipart)
                               POST /api/v1/translate/base64 (JSON)
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  Image Preprocessor  │  ← Sharp
                          │  (greyscale, sharpen) │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │  Google Cloud Vision │  ← DOCUMENT_TEXT_DETECTION
                          │  OCR Service         │    (layout-aware, multilingual)
                          └──────────┬───────────┘
                                     │ rawText + confidence + blocks
                                     ▼
                          ┌──────────────────────┐
                          │  OpenAI GPT-4o        │  ← Structured JSON prompt
                          │  Medical NLU Service  │    (MediSimple system prompt)
                          └──────────┬───────────┘
                                     │
                                     ▼
                          Structured plain-English response
                          { medicineName, purpose, dosage,
                            sideEffects, warnings, ... }
```

### Request Flow in Detail

```
Client → Auth Middleware (API Key)
       → Rate Limiter (per-key, per-window)
       → Upload Middleware (multer / body-parser)
       → Request Validator (express-validator)
       → translatorService.translateLabel()
           ├─ [if image] imageProcessor.preprocessImageForOCR()
           ├─ [if image] visionService.extractTextFromImage()
           ├─ [if mlkit] visionService.processMLKitText()
           └─ gptService.explainMedicineLabel()
       → JSON Response
       → Error Handler (normalised envelope)
```

---

## Project Structure

```
medicine-label-translator/
├── src/
│   ├── server.js              # Entry point, graceful shutdown
│   ├── app.js                 # Express factory (testable)
│   ├── config/
│   │   └── index.js           # Centralised config + env validation
│   ├── routes/
│   │   ├── translate.js       # /translate/image, /mlkit, /base64
│   │   └── health.js          # /health, /health/ready, /health/info
│   ├── services/
│   │   ├── translatorService.js   # Pipeline orchestrator
│   │   ├── visionService.js       # Google Cloud Vision OCR
│   │   └── gptService.js          # OpenAI GPT-4o medical NLU
│   ├── middleware/
│   │   ├── auth.js            # API key auth
│   │   ├── upload.js          # Multer + file validation
│   │   ├── requestLogger.js   # Request ID + Morgan
│   │   └── errorHandler.js    # Global error + 404 handler
│   ├── utils/
│   │   ├── logger.js          # Winston + daily rotation
│   │   ├── errors.js          # Typed API error classes
│   │   └── imageProcessor.js  # Sharp preprocessing pipeline
│   └── __tests__/
│       └── translate.test.js  # Integration tests (mocked APIs)
├── uploads/                   # Temp upload dir (auto-created)
├── logs/                      # Log files (auto-created)
├── config/
│   └── gcp-service-account.json   # GCP key (gitignored)
├── Dockerfile
├── docker-compose.yml
├── jest.config.js
├── .env.example
└── package.json
```

---

## Prerequisites

| Tool | Min Version |
|------|------------|
| Node.js | 18.x |
| npm | 9.x |
| Google Cloud Vision API | enabled on your GCP project |
| OpenAI API Key | GPT-4o access |

---

## Setup

### 1. Clone & Install

```bash
git clone <repo>
cd medicine-label-translator
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your keys
```

**Minimum required `.env` keys:**

```env
OPENAI_API_KEY=sk-...
GOOGLE_APPLICATION_CREDENTIALS=./config/gcp-service-account.json
GCP_PROJECT_ID=your-project-id
ALLOWED_API_KEYS=your-secret-key-here
```

### 3. GCP Service Account

1. In Google Cloud Console → **IAM & Admin** → **Service Accounts**
2. Create a service account with the **Cloud Vision API User** role
3. Download the JSON key → save to `config/gcp-service-account.json`

> **Container/serverless deployments:** Set `GOOGLE_CREDENTIALS_BASE64` to the
> base64-encoded contents of the JSON key instead of mounting a file.
> ```bash
> base64 -i config/gcp-service-account.json | tr -d '\n'
> ```

### 4. Run

```bash
# Development (with nodemon hot-reload)
npm run dev

# Production
npm start

# Docker Compose
docker-compose up --build
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.  
All protected endpoints require the `x-api-key` header.

---

### `POST /api/v1/translate/image`

Upload a raw label photo for full Cloud Vision OCR + GPT explanation.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | file | ✅ | JPEG, PNG, WebP, or HEIC image |

**Headers:**
```
x-api-key: your-api-key
Content-Type: multipart/form-data
```

**Example (cURL):**
```bash
curl -X POST http://localhost:3000/api/v1/translate/image \
  -H "x-api-key: your-api-key" \
  -F "image=@/path/to/label.jpg"
```

---

### `POST /api/v1/translate/mlkit`

Send pre-extracted text from Google ML Kit (on-device OCR).  
**Recommended for mobile apps** — skips Vision API call, reduces latency and cost.

**Request:** `application/json`

```json
{
  "text": "Paracetamol 500mg Tablets\nDosage: 1-2 tablets every 4-6 hours..."
}
```

**Android (ML Kit) Integration:**

```kotlin
// In your Android ViewModel / Repository
val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

recognizer.process(InputImage.fromBitmap(bitmap, 0))
    .addOnSuccessListener { visionText ->
        // Forward extracted text to your backend
        val payload = JSONObject().put("text", visionText.text)
        
        // POST to /api/v1/translate/mlkit
        apiService.translateMLKit(
            apiKey = BuildConfig.API_KEY,
            body = payload
        )
    }
```

---

### `POST /api/v1/translate/base64`

Send a base64-encoded image (useful for React Native / web clients).

**Request:** `application/json`

```json
{
  "image": "<base64-encoded image data>",
  "mime": "image/jpeg"
}
```

---

### Success Response (all translate endpoints)

**HTTP 200**

```json
{
  "success": true,
  "requestId": "b3f2a1e4-...",
  "pipeline": "cloud-vision",
  "explanation": {
    "medicineName": {
      "brand": "Calpol",
      "generic": "Paracetamol"
    },
    "purpose": "Relieves mild to moderate pain such as headache, toothache, and reduces fever.",
    "dosage": {
      "dose": "1 to 2 tablets",
      "frequency": "Every 4 to 6 hours",
      "timing": "As needed for pain or fever",
      "withFood": "Can be taken with or without food"
    },
    "sideEffects": [
      "Feeling sick (nausea) — uncommon",
      "Skin rash — rare, stop taking if this happens"
    ],
    "warnings": [
      "Do not take more than 8 tablets in 24 hours",
      "Do not use with other medicines that contain paracetamol"
    ],
    "doNotTake": [
      "If you are allergic to paracetamol",
      "If you have liver problems — talk to a doctor first"
    ],
    "storage": "Store below 25°C, away from sunlight. Keep out of reach of children.",
    "safetyTip": "If your symptoms do not improve after 3 days, see a doctor.",
    "rawConfidence": "high",
    "disclaimerRequired": false,
    "rawOcrText": "Calpol Paracetamol 500mg...",
    "ocrConfidence": 0.9421,
    "detectedLanguage": "en",
    "usage": {
      "promptTokens": 312,
      "completionTokens": 198,
      "totalTokens": 510
    }
  },
  "meta": {
    "timings": {
      "preprocessMs": 45,
      "ocrMs": 820,
      "gptMs": 1350,
      "totalMs": 2220
    },
    "ocrCharCount": 284,
    "ocrConfidence": 0.9421,
    "detectedLanguage": "en",
    "gptModel": "gpt-4o"
  }
}
```

---

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "text", "msg": "text must be a string" }],
    "requestId": "b3f2a1e4-..."
  }
}
```

| HTTP Status | Code | Cause |
|-------------|------|-------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Image format not accepted |
| 422 | `VALIDATION_ERROR` | Invalid request body / field |
| 429 | `RATE_LIMITED` | Too many requests |
| 502 | `OCR_FAILED` | Cloud Vision API error |
| 502 | `GPT_FAILED` | OpenAI API error |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

### Health Endpoints (no auth required)

```
GET /health          → liveness probe
GET /health/ready    → readiness probe (checks config)
GET /health/info     → system info (dev only)
```

---

## Google ML Kit Integration Guide

ML Kit runs **entirely on-device** (no internet required for OCR). The recommended
architecture is:

```
Phone Camera → ML Kit TextRecognition → Raw Text
                                           │
                     POST /translate/mlkit ▼
                           Backend → GPT-4o → Plain English
```

**Why this is better than sending the raw image:**
- Faster (no image upload over mobile network)
- Works offline for the OCR step
- Lower Vision API costs (you don't call it at all)
- Better privacy (label text is less sensitive than a full image)

Set `MLKIT_PASSTHROUGH_ENABLED=true` in your `.env` to enable this path.

---

## Running Tests

```bash
# Run all tests (APIs are mocked — no real keys needed)
npm test

# With coverage report
npm test -- --coverage

# Watch mode
npm test -- --watch
```

---

## Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set strong random `ALLOWED_API_KEYS`
- [ ] Use `GOOGLE_CREDENTIALS_BASE64` (not file mount) for serverless
- [ ] Set `ALLOWED_ORIGINS` for CORS restriction
- [ ] Configure a reverse proxy (nginx / Cloud Load Balancer) in front
- [ ] Enable Cloud Armor or WAF for DDoS protection on the Vision/GPT endpoints
- [ ] Set up log export to Cloud Logging / Datadog
- [ ] Configure alerting on `OCR_FAILED` and `GPT_FAILED` error rates

---

## Cost Estimates (per 1,000 label scans)

| Service | Pricing | Est. Cost / 1K |
|---------|---------|----------------|
| Cloud Vision DOCUMENT_TEXT_DETECTION | $1.50 / 1K units | **$1.50** |
| GPT-4o (avg 500 tokens) | $2.50/1M input + $10/1M output | **~$0.65** |
| ML Kit (on-device) | Free | **$0.00** |

> Using ML Kit passthrough eliminates the Vision API cost entirely.
