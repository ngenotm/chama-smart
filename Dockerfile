# ---- Dependencies (lean image) ----
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Install only production deps + skip scripts (Prisma generate later)
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---- Builder ----
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Rebuild native modules (better-sqlite3 etc.)
RUN npm rebuild better-sqlite3

# Prisma setup
RUN npx prisma generate

# Build Next.js (standalone output)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_DISABLE_ESLINT=1

RUN npm run build

# ---- Runner ----
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat su-exec

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Full node_modules (needed for Prisma at runtime)
COPY --from=builder /app/node_modules ./node_modules

# Package files + Prisma files
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./ 2>/dev/null || true

# Persistent data volume
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Entrypoint for permissions + startup
COPY --from=builder /app/entrypoint.sh /app/entrypoint.sh 2>/dev/null || true
RUN if [ -f /app/entrypoint.sh ]; then chmod +x /app/entrypoint.sh; fi

EXPOSE 3000

# Run as non-root
USER nextjs

CMD ["node", "server.js"]
