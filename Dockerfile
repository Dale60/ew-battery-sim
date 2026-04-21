# =============================================================================
# Eden Worth Battery Simulator — Dockerfile
# Multi-stage build: keeps the final image small (~180MB)
# =============================================================================
FROM node:22-slim AS builder
WORKDIR /app

# better-sqlite3 needs build tools during install
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# -----------------------------------------------------------------------------
FROM node:22-slim
WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# Data directory (mounted as volume)
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/battery-sim.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
