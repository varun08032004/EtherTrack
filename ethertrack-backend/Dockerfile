# EtherTrack Backend - Production Dockerfile
# Multi-stage build for smaller production image

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies (including dev for build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Run build if needed (e.g., TypeScript compilation)
# RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs etherTrack

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=etherTrack:nodejs /app .

# Create necessary directories
RUN mkdir -p /app/logs /app/uploads /app/tmp && \
    chown -R etherTrack:nodejs /app/logs /app/uploads /app/tmp

# Switch to non-root user
USER etherTrack

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]