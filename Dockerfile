FROM node:22-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ libc6-compat

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy the rest of the application
COPY . .

# Generate Prisma Client (only if needed at build time)
# If you prefer to run prisma generate locally before building, you can comment this out
RUN npx prisma generate

# Build the app
RUN npm run build

EXPOSE 3000

# Use non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    chown -R nextjs:nodejs /app

USER nextjs

CMD ["npm", "run", "start"]
