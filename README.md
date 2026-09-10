# GaitDesk

A browser-based application for ranch and western pleasure horse shows.

## What This App Does

- Manages shows, classes, entries, exhibitors, horses, and show staff.
- Assigns show-level back numbers.
- Lets authorized scribes manually enter placings.
- Supports score-driven placings for pattern/time classes.
- Supports optional side-pot payouts across class bundles.
- Publishes results live.
- Supports APHA-specific class import/export and certification checks.
- Supports AQHA class-code import, AQHA class picker, approval metadata, workshop tracking, and first-pass AQHA entry/schedule validation.
- Supports trainer registry links with horse-level free-text fallback.
- Supports per-show class templates and schedule-builder tools for quickly creating ordered class lineups.

## What This App Does Not Do

- No judging.
- No maneuver scoring.
- No penalty calculations.
- No judging-rule engine. The app has limited association compliance validation where the required data is modeled, such as AQHA class-code/registration/workshop/age checks.

Placings entered by authorized show staff are final, with audit history for result changes.

## Supported Associations

- AQHA - American Quarter Horse Association
- APHA - American Paint Horse Association
- WSCA - Western Saddle Clubs Association
- NSBA - National Snaffle Bit Association
- ApHC - Appaloosa Horse Club
- FQHR - Foundation Quarter Horse Registry
- OPEN - Open / Unaffiliated

## Roles

- `ADMIN`: full system access.
- `SHOW_MANAGER`: requests and manages hosted shows.
- `SHOW_SECRETARY`: manages assigned shows, entries, classes, back numbers, and result administration.
- `SCRIBE`: enters placings for assigned shows.
- `EXHIBITOR`: views own entries/results and manages profile/horses.
- `TRAINER`: manages a linked trainer registry profile used on horse records.

Show Secretary, Show Manager, Trainer, and Exhibitor accounts are currently auto-approved. Show Manager show hosting requests require admin approval before a draft show is created.

## Tech Stack

- Backend: FastAPI
- Frontend: Next.js PWA
- Database: PostgreSQL on Neon
- Local runtime: Docker Compose

## Getting Started

Copy and fill in environment variables:

```bash
cp .env.example .env
```

Required values include:

- `DATABASE_URL` — point this at the **dev** Neon branch, never the one
  production serves from. See [docs/deployment.md](docs/deployment.md).
- `INTERNAL_API_KEY`
- `NEXTAUTH_SECRET`

Start the app:

```bash
docker-compose up
```

Local services:

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

Apply any unapplied migrations to the dev branch:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

Run every check the way CI does:

```bash
bash RUN_TESTS.sh
```

## Environments And Releasing

| | Runs | Database |
| --- | --- | --- |
| dev | `docker-compose up` locally | Neon `dev` branch (local `.env`) |
| production | gaitdesk.com / api.gaitdesk.com on Render | Neon production branch (set only in Render) |

**`git push origin main` is the deploy.** Both Render services are on
`autoDeployTrigger: checksPass`, so a push releases as soon as CI passes. There
is no separate release button and no staging environment.

**A commit carrying a migration is a release, and the order matters.**
Production's database is a different Neon branch that your local migration run
did not touch, and whether the migration goes before or after the deploy is
decided by the migration itself — getting it wrong took the site down once.
Read [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md) before
pushing schema.

## Documentation

- AI/developer orientation: [Claude.md](Claude.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Auth and roles: [docs/auth.md](docs/auth.md)
- Database and migrations: [docs/database.md](docs/database.md)
- Frontend conventions: [docs/frontend.md](docs/frontend.md)
- Show workflow: [docs/show-workflow.md](docs/show-workflow.md)
- Deployment, environments, releasing, rollback: [docs/deployment.md](docs/deployment.md)
- Contributing and the commit workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- APHA behavior: [docs/apha.md](docs/apha.md)
- AQHA behavior: [docs/aqha.md](docs/aqha.md)
- Historical improvements: [IMPROVEMENTS.md](IMPROVEMENTS.md)

## Status

Active development.
