# ==========================================
# Stage 1: Build & Compile Native Dependencies
# ==========================================
FROM docker.io/library/node:20-slim AS builder

WORKDIR /app

# Install build tools required for node-gyp (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY package*.json ./

# Install all production dependencies (compiles native C++ modules here)
RUN npm ci --omit=dev --no-audit --no-fund

# ==========================================
# Stage 2: Final Production Runner Image
# ==========================================
FROM docker.io/library/node:20-slim AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy compiled node_modules and package.json from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Copy application source code
COPY . .

# Expose port (adjust if your app uses a different port)
EXPOSE 3000

# Run as non-root user for security
USER node

CMD ["node", "index.js"]
