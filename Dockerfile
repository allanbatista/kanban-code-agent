FROM node:24-slim AS build
RUN npm i -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/package.json web/pnpm-lock.yaml ./web/
RUN cd web && pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN cd web && pnpm run build && cd .. && pnpm run build:src

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/*
# codex CLI pinado na versao validada (F1.3/F4.2) — agent codex + login no server.
RUN npm i -g pnpm@10 @openai/codex@0.144.1
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
EXPOSE 35000
CMD ["node", "dist/cli/index.js", "server"]
