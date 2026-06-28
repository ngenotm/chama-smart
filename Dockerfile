FROM node:20-bookworm-slim

# Calibre's Qt WebEngine refuses to run as root without this.
# Also suppress the XDG_RUNTIME_DIR warning.
ENV QTWEBENGINE_DISABLE_SANDBOX=1
ENV XDG_RUNTIME_DIR=/tmp/runtime-root

WORKDIR /app

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
