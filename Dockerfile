# syntax=docker/dockerfile:1

FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache libc6-compat openssl

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

# Build application
RUN npm run build

# Expose port
EXPOSE 3050

# Use entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
