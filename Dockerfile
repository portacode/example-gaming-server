# Use Node.js LTS as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies required for the build
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies from the final runtime image
RUN npm prune --omit=dev

# Expose port
EXPOSE 5000

# Start server
CMD ["npm", "start"]
