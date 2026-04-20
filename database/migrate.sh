#!/bin/bash
# Applies any unapplied migrations in database/migrations/ to the Neon database.
# Requires DATABASE_URL to be set (loaded from .env if present).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# Load .env from project root if present
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

# Convert asyncpg URL to psql-compatible URL
PSQL_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"

# Ensure migrations tracking table exists
docker run --rm postgres:16-alpine psql "$PSQL_URL" -c "
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  );" > /dev/null

# Apply each migration in order if not already applied
for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  already_applied=$(docker run --rm postgres:16-alpine psql "$PSQL_URL" -tAc \
    "SELECT COUNT(*) FROM _migrations WHERE name = '$name';")

  if [ "$already_applied" = "1" ]; then
    echo "  skipped: $name (already applied)"
  else
    echo "  applying: $name"
    docker run --rm -v "$MIGRATIONS_DIR:/migrations" postgres:16-alpine \
      psql "$PSQL_URL" -f "/migrations/$name"
    docker run --rm postgres:16-alpine psql "$PSQL_URL" -c \
      "INSERT INTO _migrations (name) VALUES ('$name');" > /dev/null
    echo "  done: $name"
  fi
done

echo "Migrations complete."
