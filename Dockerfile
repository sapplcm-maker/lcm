FROM node:20-slim

# Prevent interactive debconf prompts during build
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /usr/src/app

# Install build dependencies required for compiling native modules (like better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy remaining source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
