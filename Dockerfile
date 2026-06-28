FROM node:20-bookworm-slim

# Install Pandoc and Calibre
RUN apt-get update && \
    apt-get install -y pandoc calibre && \
    rm -rf /var/lib/apt/lists/*

ENV QTWEBENGINE_DISABLE_SANDBOX=1
ENV XDG_RUNTIME_DIR=/tmp/runtime-root

WORKDIR /app

COPY package*.json ./

# Prisma files - make config optional
COPY prisma ./prisma/
COPY prisma.config.ts ./ 2>/dev/null || true

RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
