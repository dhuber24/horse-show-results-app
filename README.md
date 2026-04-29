# Horse Show Results App

A browser-based application for ranch and western pleasure horse shows.

## What this app does
- Exhibitors sign up for classes
- Show office assigns back numbers
- Official scorekeepers manually enter placings
- Results are published live

## What this app does NOT do
- No judging
- No maneuver scoring
- No penalties
- No rule enforcement

Placings entered by the show office are final.

## Supported Associations
- AQHA (American Quarter Horse Association)
- APHA (American Paint Horse Association)
- WSCA (Western States Cutting Association)
- NSBA (National Snaffle Bit Association)
- ARHA (American Ranch Horse Association)
- ApHC (Appaloosa Horse Club)
- FQHR (Foundation Quarter Horse Registry)
- OPEN (Open / Unaffiliated)

## Roles
- **Admin** — full system access, show setup, user management
- **Show Secretary** — manages assigned shows and scorekeepers
- **Scorekeeper** — enters placings for assigned shows
- **Exhibitor** — views personal entries and results

## Tech Stack
- Backend: FastAPI (Python)
- Frontend: Next.js (PWA)
- Database: PostgreSQL (Neon cloud)
- Deployment: Docker + GitHub Codespaces

## Security
- Show Secretary registration requires admin approval before login
- Per-show authorization for secretaries managing rings/divisions/classes
- Input validation on all user-controlled API endpoints
- File upload validation via magic-byte detection (not client Content-Type)
- Audit trail for result changes with user attribution
- PII endpoints require authentication

## Status
🔨 Active Development

## Getting Started
```bash
# Copy and fill in your environment variables (DATABASE_URL, INTERNAL_API_KEY, NEXTAUTH_SECRET)
cp .env.example .env

docker-compose up
# Frontend: http://localhost:3000
# Backend:  http://localhost:8000
```

See [CLAUDE.md](./CLAUDE.md) for full project documentation.
