# syntax=docker/dockerfile:1
# canvai — obraz produkcyjny (AdonisJS + Inertia/React, SQLite na wolumenie).

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV CI=true

# Zależności deweloperskie (build frontendu i TypeScriptu).
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# `codegen` odtwarza .adonisjs/ (rejestr tras, indeksy stron) — nie ma go w repo.
# Oba polecenia bootują aplikację i walidują env, więc dostają tu atrapy
# (nadpisują też puste ARG-i wstrzykiwane przez Coolify); prawdziwe wartości
# trafiają do kontenera dopiero w runtime.
RUN env NODE_ENV=production HOST=0.0.0.0 PORT=3333 LOG_LEVEL=info \
      APP_KEY=build-only-placeholder-key-000000 APP_URL=http://localhost:3333 \
      SESSION_DRIVER=cookie DB_CONNECTION=sqlite AI_PROVIDER=mock MAIL_MAILER=outbox \
      DEEPSEEK_API_KEY= RESEND_API_KEY= \
    sh -c 'node ace codegen && node ace build'

# Tylko zależności produkcyjne.
FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333 \
    TZ=UTC \
    SQLITE_PATH=/app/data/db.sqlite3 \
    STORAGE_PATH=/app/data/storage
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh
# Katalog danych należy do `node` — nowy wolumen dziedziczy właściciela.
RUN mkdir -p /app/data/storage && chown -R node:node /app/data
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "./docker/entrypoint.sh"]
