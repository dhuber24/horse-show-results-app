#!/bin/bash
# Applies any unapplied migrations in database/migrations/ to the Neon database.
#
# Kept at parity with migrate.ps1 -- same target precedence, same production
# guard, same recording rules. It previously had none of them: no guard at all
# (so a Codespace or WSL shell, where this is the natural runner, was
# completely unprotected while the docs claimed the guard "travels with the
# repository"), and no ON_ERROR_STOP, so a migration whose statements failed
# still got an _migrations row saying it had been applied.
#
# The target is chosen in this order, and printed before anything runs:
#
#   1. --database-url <url>
#   2. $DATABASE_URL
#   3. DATABASE_URL in .env
#
# .env never overwrites a variable the environment already has -- a value in
# the environment is a deliberate act by the caller, a .env file is a default.
#
# Releasing to production:
#   ./database/migrate.sh --allow-production --database-url "<production url>"
#
# See the release skill (.claude/skills/release/) first: whether the migration
# goes before or after the deploy is decided by the migration, not by
# preference.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
HASH_FILE="$SCRIPT_DIR/production-hosts.sha256"

ALLOW_PRODUCTION=0
CLI_DATABASE_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-production) ALLOW_PRODUCTION=1; shift ;;
    --database-url) CLI_DATABASE_URL="${2:-}"; shift 2 ;;
    --database-url=*) CLI_DATABASE_URL="${1#*=}"; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Load .env without clobbering the environment. Parsed line by line rather than
# through `export $(... | xargs)`, which overwrote everything, mangled values
# containing spaces or quotes, and would happily execute a value with a
# backtick in it.
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [ -z "${!key:-}" ]; then
      value="${line#*=}"
      value="${value%$'\r'}"
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

if [ -n "$CLI_DATABASE_URL" ]; then
  DB_URL="$CLI_DATABASE_URL"
  DB_URL_SOURCE="--database-url"
else
  DB_URL="${DATABASE_URL:-}"
  DB_URL_SOURCE="DATABASE_URL (environment or .env)"
fi

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

# Convert asyncpg URL to psql-compatible URL
PSQL_URL="${DB_URL/postgresql+asyncpg/postgresql}"

# Say where this is going. Credentials are never printed.
TARGET_HOST="unknown"
if [[ "$DB_URL" =~ @([^/:?]+) ]]; then
  TARGET_HOST="${BASH_REMATCH[1]}"
fi
echo "Target database: $TARGET_HOST"
echo "  (from $DB_URL_SOURCE)"

# Production hosts by SHA-256, shared with migrate.ps1. An unreadable or empty
# list is a hard failure, never an unguarded run.
if [ ! -f "$HASH_FILE" ]; then
  echo "ERROR: $HASH_FILE is missing - refusing to run with the guard disabled." >&2
  exit 1
fi

PRODUCTION_HASHES="$(sed 's/#.*//' "$HASH_FILE" | tr -d '[:blank:]' \
  | grep -E '^[0-9a-f]{64}$' || true)"
if [ -z "$PRODUCTION_HASHES" ]; then
  echo "ERROR: no production host hashes in $HASH_FILE - refusing to run with the guard disabled." >&2
  exit 1
fi

TARGET_HASH="$(printf '%s' "$TARGET_HOST" | tr '[:upper:]' '[:lower:]' \
  | sha256sum | cut -d' ' -f1)"

IS_PRODUCTION=0
if printf '%s\n' "$PRODUCTION_HASHES" | grep -qx "$TARGET_HASH"; then
  IS_PRODUCTION=1
fi

# An explicitly configured host is additional, never a replacement.
if [ -n "${PRODUCTION_DATABASE_HOST:-}" ] && [ "$TARGET_HOST" = "${PRODUCTION_DATABASE_HOST// /}" ]; then
  IS_PRODUCTION=1
fi

if [ "$IS_PRODUCTION" -eq 1 ]; then
  if [ "$ALLOW_PRODUCTION" -ne 1 ]; then
    cat >&2 <<MSG

Refusing to migrate: $TARGET_HOST is a known production database.

A migration against the database production is serving from breaks the running
release the moment it renames or drops anything, and the readiness probe will
not go red until the next check.

To migrate a development branch instead, point DATABASE_URL at it.
To release to production deliberately, re-run with:
  ./database/migrate.sh --allow-production

See the release skill (.claude/skills/release/) first: whether the migration
goes before or after the deploy is decided by the migration.

MSG
    exit 1
  fi
  echo "Proceeding against PRODUCTION (--allow-production given)."
fi

psql_run() {
  docker run --rm postgres:16-alpine psql "$PSQL_URL" "$@"
}

# Ensure migrations tracking table exists
psql_run -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  );" > /dev/null

# Apply each migration in order if not already applied
for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  already_applied="$(psql_run -tAc \
    "SELECT COUNT(*) FROM _migrations WHERE name = '$name';" | tr -d '[:space:]')"

  if [ "$already_applied" = "1" ]; then
    echo "  skipped: $name (already applied)"
  else
    echo "  applying: $name"
    # ON_ERROR_STOP is what makes the exit status mean anything. Without it psql
    # reports success after a failed statement, and the _migrations row below
    # would then claim a migration was applied that was not.
    docker run --rm -v "$MIGRATIONS_DIR:/migrations" postgres:16-alpine \
      psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "/migrations/$name"

    # Many migrations record themselves (INSERT INTO _migrations ... ON CONFLICT
    # DO NOTHING) so that hand-applying one in Neon's SQL editor still leaves the
    # row behind. Re-check rather than insert blindly.
    recorded="$(psql_run -tAc \
      "SELECT COUNT(*) FROM _migrations WHERE name = '$name';" | tr -d '[:space:]')"
    if [ "$recorded" != "1" ]; then
      psql_run -v ON_ERROR_STOP=1 -c \
        "INSERT INTO _migrations (name) VALUES ('$name');" > /dev/null
    fi
    echo "  done: $name"
  fi
done

echo "Migrations complete."
