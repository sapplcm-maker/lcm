# Stage 1: Build & Compile Native Dependencies
FROM docker.io/library/node:20-slim AS builder

WORKDIR /app

# Install build tools required for node-gyp (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund

# Stage 2: Final Production Runner Image
FROM docker.io/library/node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

EXPOSE 3000

USER node

CMD ["node", "index.js"]
