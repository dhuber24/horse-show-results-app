# Horse Show Results App

A browser-based application for ranch and western pleasure horse shows.

## What This App Does

- Manages shows, classes, entries, exhibitors, horses, and show staff.
- Assigns show-level back numbers.
- Lets authorized scorekeepers manually enter placings.
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
- WSCA - Western States Cutting Association
- NSBA - National Snaffle Bit Association
- ApHC - Appaloosa Horse Club
- FQHR - Foundation Quarter Horse Registry
- OPEN - Open / Unaffiliated

## Roles

- `ADMIN`: full system access.
- `SHOW_MANAGER`: requests and manages hosted shows.
- `SHOW_SECRETARY`: manages assigned shows, entries, classes, back numbers, and result administration.
- `SCOREKEEPER`: enters placings for assigned shows.
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

- `DATABASE_URL`
- `INTERNAL_API_KEY`
- `NEXTAUTH_SECRET`

Start the app:

```bash
docker-compose up
```

Local services:

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## Documentation

- AI/developer orientation: [Claude.md](Claude.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Auth and roles: [docs/auth.md](docs/auth.md)
- Database and migrations: [docs/database.md](docs/database.md)
- Frontend conventions: [docs/frontend.md](docs/frontend.md)
- Show workflow: [docs/show-workflow.md](docs/show-workflow.md)
- APHA behavior: [docs/apha.md](docs/apha.md)
- AQHA behavior: [docs/aqha.md](docs/aqha.md)
- Historical improvements: [IMPROVEMENTS.md](IMPROVEMENTS.md)

## Status

Active development.
