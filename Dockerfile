# syntax=docker/dockerfile:1.7

# ---- Stage 1: Build ----
FROM node:24-alpine AS builder

WORKDIR /app


COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

# ---- Stage 2: Production ----
FROM node:24-alpine AS production

ENV NODE_ENV=production
ENV PORT=4000

WORKDIR /app

COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy the built output from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

USER node

# The app listens on this port
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Default: start the API server
CMD ["node", "dist/src/main"]