#!/bin/sh
# Start kontenera: katalogi na wolumenie → migracje → serwer HTTP
# (z workerem kolejki generacji DESIGN.md w tym samym procesie).
set -e

mkdir -p "$(dirname "${SQLITE_PATH:-/app/data/db.sqlite3}")" "${STORAGE_PATH:-/app/data/storage}"

node ace migration:run --force
exec node bin/server.js
