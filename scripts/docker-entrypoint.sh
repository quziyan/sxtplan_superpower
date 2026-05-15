#!/usr/bin/env bash
# Plan-PP docker:容器启动序列 — 等 PG → migrations → seed → exec server
set -euo pipefail

echo "[entrypoint] waiting for postgres at ${POSTGRES_HOST:-cnp-postgres}:${POSTGRES_PORT_INTERNAL:-5432}..."
for i in $(seq 1 60); do
  if pg_isready -h "${POSTGRES_HOST:-cnp-postgres}" -p "${POSTGRES_PORT_INTERNAL:-5432}" -U "${POSTGRES_USER:-cnp}" -d "${POSTGRES_DB:-cnp}" -q; then
    echo "[entrypoint] postgres ready (after ${i}s)"
    break
  fi
  sleep 1
  if [ "$i" = "60" ]; then
    echo "[entrypoint] postgres NOT ready after 60s,abort"
    exit 1
  fi
done

echo "[entrypoint] running drizzle migrations..."
bun src/db/migrate.ts

echo "[entrypoint] seeding bootstrap admin (idempotent)..."
bun src/db/seed-bootstrap.ts || echo "[entrypoint] bootstrap seed exited non-zero (likely already seeded),continue"

echo "[entrypoint] seeding vehicle taxonomy (idempotent)..."
bun scripts/seed-vehicle-taxonomy.ts || echo "[entrypoint] taxonomy seed exited non-zero,continue"

echo "[entrypoint] starting server on port ${PORT:-3000}..."
exec bun src/server.ts
