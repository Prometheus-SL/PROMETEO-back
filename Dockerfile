# Production image for the PROMETEO backend.
# Puppeteer (whatsapp-web.js) needs Chrome and its system libraries, so the
# image installs Chrome for Testing plus its Debian deps at build time.
FROM node:22.19.0-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
 && npm ci --omit=dev \
 && npx --yes puppeteer browsers install chrome --install-deps \
 && apt-get install -y --no-install-recommends fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY . .
RUN chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
