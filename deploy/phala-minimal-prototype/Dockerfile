FROM node:22-bookworm-slim

WORKDIR /app

COPY deploy/phala-minimal-prototype/server.mjs ./server.mjs

ENV API_PORT=8787
EXPOSE 8787

CMD ["node", "server.mjs"]
