# Stage 1: Builder
FROM docker.io/library/node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Changed 'npm ci' to 'npm install'
RUN npm install --omit=dev --no-audit --no-fund

# Stage 2: Runner
FROM docker.io/library/node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

EXPOSE 3000

USER node

CMD ["npm", "start"]
