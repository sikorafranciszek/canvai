#!/bin/sh
# Start kontenera: katalogi na wolumenie → migracje PostgreSQL → jednorazowy
# import danych ze starej bazy SQLite (tylko gdy Postgres jest pusty) →
# serwer HTTP (z workerem kolejki generacji DESIGN.md w tym samym procesie).
set -e

mkdir -p "${STORAGE_PATH:-/app/data/storage}"

node ace migration:run --force
node ace db:import-sqlite --if-empty
exec node bin/server.js
