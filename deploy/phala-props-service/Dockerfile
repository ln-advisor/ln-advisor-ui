FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV API_PORT=8787
ENV LIGHTNING_SNAPSHOT_MODE=mock
ENV API_RETENTION_MODE=none

EXPOSE 8787

CMD ["pnpm", "api"]
