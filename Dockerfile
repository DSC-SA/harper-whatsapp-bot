# Harper — WhatsApp bot
# Build: public.ecr.aws/docker/library/node:20-slim (with ffmpeg + fonts for stickers)

FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/index.js"]