FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY sql ./sql
COPY prompts ./prompts
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl procps tini \
 && curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/sql ./sql
COPY --from=build /app/prompts ./prompts
RUN mkdir -p /app/storage /app/codex-data /home/node/.gemini /home/node/.local/bin \
 && chmod 700 /app/codex-data /home/node/.gemini \
 && chown -R node:node /app /home/node/.gemini /home/node/.local
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/index.js"]

