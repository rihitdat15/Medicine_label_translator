# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install build tools needed for sharp (native bindings)
RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Production Image ────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Runtime deps for sharp
RUN apk add --no-cache vips

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY package.json ./

# Create runtime directories with correct ownership
RUN mkdir -p uploads logs && chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Healthcheck for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
