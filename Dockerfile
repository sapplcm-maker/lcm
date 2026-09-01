FROM node:20-slim

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy remaining source code
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
