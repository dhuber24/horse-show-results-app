---
name: Neon Database Setup
description: Cloud PostgreSQL on Neon, migration workflow, and connection details
type: project
---

Migrated from local Docker PostgreSQL to Neon cloud database.

**Neon project:** horse-show-results (us-east-2)
**Connection string format:** `postgresql+asyncpg://neondb_owner:<password>@ep-round-scene-aerjqimm.c-2.us-east-2.aws.neon.tech/neondb?ssl=true`
**Connection string lives in:** `.env` at project root (gitignored)

**Why:** Shared database between local dev and GitHub Codespace so data stays in sync across devices.

**How to apply:**
- Local: `DATABASE_URL` is read from `.env`
- Codespace: `DATABASE_URL` is set as a GitHub Codespace Secret (Settings → Codespaces → Secrets)
- docker-compose.yml reads `DATABASE_URL` from environment

**Running migrations:**
```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```
- Script lives at `database/migrate.ps1`
- Tracks applied migrations in a `_migrations` table on Neon
- Never runs the same migration twice
- Reads `DATABASE_URL` from `.env` automatically

**Restarting Docker after changes:**
```bash
docker-compose up --build   # first time or after dependency changes
docker-compose up           # normal restarts
```
