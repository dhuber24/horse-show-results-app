---
name: Neon Database Setup
description: Cloud PostgreSQL on Neon, migration workflow, and connection details
type: project
---

The project uses Neon cloud PostgreSQL instead of a local Docker database.

Connection string format:

```text
postgresql+asyncpg://neondb_owner:<password>@<host>/<database>?ssl=true
```

The connection string lives in `.env` locally and should remain gitignored.

## Why Neon

Neon keeps data shared between local development and Codespaces so the project does not depend on a local Postgres container.

## Environment

- Local: `DATABASE_URL` is read from `.env`.
- Codespaces: `DATABASE_URL` is configured as a Codespaces secret.
- `docker-compose.yml` passes `DATABASE_URL` into the backend service.

## Migrations

Preferred local command:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

The runner tracks applied migrations in `_migrations` and skips files that are already recorded.

Direct SQL fallback is documented in `docs/database.md`.

## Docker Restarts

```bash
docker-compose up --build
docker-compose up
```

