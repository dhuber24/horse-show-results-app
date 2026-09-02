# Contributing to Horse Show Results App

Thank you for contributing! This document provides guidelines for working on this project.

## Table of Contents
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
  - [Committing](#committing)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process) (branch work only)

## Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/dhuber24/horse-show-results-app.git
   cd horse-show-results-app
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

3. **Start development environment**
   ```bash
   docker-compose up
   ```

   Or for local development without Docker, refer to CLAUDE.md for environment details.

## Development Workflow

### Documentation Guard

This repo uses a versioned pre-commit hook in `.githooks/pre-commit`. The hook runs `scripts/check-docs-updated.ps1` and blocks commits that stage implementation, database, runtime, or frontend files without also staging a documentation update.

Install the hook path once per clone:

```bash
git config core.hooksPath .githooks
```

When behavior, setup, schema, workflow, or architecture changes, update the relevant docs in `Claude.md`, `README.md`, `docs/`, `database/README.md`, or `frontend/README.md`.

For changes with no documentation impact, bypass one commit:

```bash
DOCS_CHECK_BYPASS=1 git commit -m "..."
```

### Committing

**This repo commits straight to `main`.** One person works on it, so the two
things a branch buys -- keeping your work off somebody else's, and holding a
change behind review -- do not apply, and CI runs on pushes to `main` as well
as on pull requests (see `.github/workflows/ci.yml`). History is linear; keep
it that way.

```bash
git pull origin main
# ... work, and run the checks below ...
git add -A
git commit
git push origin main
```

Branch only for work you might genuinely abandon or shelve for a while:

```bash
git checkout -b feature/description   # or fix/, docs/, refactor/, test/, chore/
```

**A branch does not isolate the database.** `DATABASE_URL` points at one shared
Neon instance, so a migration is applied the moment you run it, whatever branch
the code is on. Abandoning a branch leaves its schema change behind, and `main`
will then be running against a database it does not know about. Treat the
migration, not the code, as the thing to be careful with.

### Before You Start Coding

1. Check [Issues](https://github.com/dhuber24/horse-show-results-app/issues) for existing work
2. Read [CLAUDE.md](./CLAUDE.md) to understand system design and project conventions
3. Check if your change aligns with the [Roadmap](#roadmap) (if available)

## Code Style

### Python (Backend)

**Standards:**
- Follow [PEP 8](https://www.python.org/dev/peps/pep-0008/)
- Use type hints for all functions
- Max line length: 100 characters
- 4-space indentation

**Tools:**
```bash
# Format code
black backend/

# Check style
flake8 backend/

# Sort imports
isort backend/

# Type checking
mypy backend/
```

**Example:**
```python
from typing import Optional
from fastapi import APIRouter, Depends
from database import get_db

router = APIRouter(prefix="/shows", tags=["shows"])

async def get_show_by_id(
    show_id: str, 
    db: Session = Depends(get_db)
) -> dict:
    """
    Retrieve a show by ID.
    
    Args:
        show_id: The UUID of the show
        db: Database session
        
    Returns:
        Show data dictionary
        
    Raises:
        HTTPException: If show not found
    """
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")
    return show
```

### TypeScript/JavaScript (Frontend)

**Standards:**
- Use TypeScript for type safety
- Follow [ESLint](https://eslint.org/) configuration
- Functional components only (no class components)
- Max line length: 100 characters
- Use meaningful variable names

**Tools:**
```bash
# Format code
npm run format

# Lint code
npm run lint

# Type check
npm run type-check
```

**Example:**
```typescript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface Show {
  id: string;
  name: string;
  date: string;
  location: string;
}

export const ShowList: React.FC = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchShows = async () => {
      try {
        const response = await axios.get('/api/shows');
        setShows(response.data);
      } catch (err) {
        setError('Failed to load shows');
      } finally {
        setLoading(false);
      }
    };

    fetchShows();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {shows.map((show) => (
        <div key={show.id}>
          <h2>{show.name}</h2>
          <p>{show.date} - {show.location}</p>
        </div>
      ))}
    </div>
  );
};
```

## Testing

Both suites cover **pure logic only** — no database, no HTTP, no component rendering. That is a
deliberate first pass at the code where a silent bug costs something real: money math and health
paperwork. Widen it when there is something else worth the maintenance.

### Backend (pytest)

**Run them in Docker.** The host interpreter is Python 3.9; the backend needs 3.10+ and fails to
import on the host. `py -m compileall backend` passes regardless, because it byte-compiles without
executing — which is exactly why the compile check never caught this.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/backend:/app" -w /app   horse-show-results-app-backend:latest python -m pytest
```

`./backend` is bind-mounted, so tests written on the host run without rebuilding the image. Config
lives in `backend/pytest.ini` (not the repo root) so that rootdir is the backend package whether you
invoke it in the container, from `backend/`, or from the repo root.

Tests live in `backend/tests/`:

| File | Covers |
| --- | --- |
| `test_billing.py` | `billing.py` — early-bird rates, NSBA sanction, office charge, bills, balances, the show rollup, side pot money |
| `test_health.py` | the pure health block in `routers/horse_documents.py` — requirements, expiry, status, attestation |
| `test_rules.py` | `rules/disciplines.py` — class-name routing, plus a property test on the keyword table's ordering |
| `test_backnumbers.py` | `backnumbers.py` — show-level vs legacy back number precedence |

Subjects are duck-typed, so `tests/factories.py` builds `SimpleNamespace` stubs rather than ORM
instances. Each factory defaults everything its subject reads, so a test names only the fields it is
actually about.

Two things worth knowing before adding to it:

- `billing.py` is completely pure — no `await`, no database, importing only `date` and `typing`.
  Keep it that way; it is what makes this suite fast and worth running.
- The health tests import `routers.horse_documents`, which pulls in FastAPI, models and `database`.
  That is import-safe without a database because `create_async_engine` does not connect at import.
  If that ever changes, extract the pure block into its own module rather than adding a fixture.

### Frontend (Jest)

```bash
cd frontend
npm test                  # run
npm run test:coverage     # coverage, scoped to lib/
```

Configured in `frontend/jest.config.js` via `next/jest`. Tests sit next to their subject in
`frontend/lib/`. See the Tests section of `docs/frontend.md` for what is covered and why component
rendering is not.

Test files import `describe`/`it`/`expect` from `@jest/globals` rather than relying on ambient
globals — `tsconfig.json` type-checks `**/*.ts`, so this is what keeps `npm run type-check` passing
without adding `@types/jest`.

### Everything at once

```bash
bash RUN_TESTS.sh
```

Runs the backend suite in Docker, then the frontend type check, lint and tests. It deliberately does
not run `npm run build`: the host and the dev container share `frontend/.next` through a bind mount,
so a host-side build breaks a running dev server. CI builds instead.

### CI

`.github/workflows/ci.yml` runs all of the above on push and PR to `main`, on Node 20 and Python
3.12 to match the Dockerfiles. It also builds the frontend, and fails if any route handler under
`frontend/app/api/` calls `fetch()` directly instead of `safeFetchBackend()`.

`.github/workflows/docs-guard.yml` is separate and only checks that documentation moved with the
code.

## Commit Messages

**Format:**
```
<type>(<scope>): <subject>

<body>

Fixes #<issue-number>
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `style` — Formatting (no code change)
- `refactor` — Code refactoring
- `test` — Adding/updating tests
- `chore` — Maintenance (dependencies, etc.)

**Examples:**
```
feat(auth): add JWT token refresh endpoint

Implement token refresh mechanism with 30-day expiration.
Add refresh_token table to track valid refresh tokens.

Fixes #42

---

fix(placings): prevent duplicate placements in same class

Added unique constraint on (entry_id, class_id) to database.
Update API validation to catch duplicates before database.

Fixes #38

---

docs(readme): update installation instructions

Clarify Docker Compose setup for Windows users.

---

test(shows): add unit tests for show creation

Add test coverage for show creation endpoint.
Tests cover validation, authorization, and database persistence.
```

**Guidelines:**
- Use imperative mood ("add" not "added" or "adds")
- Don't capitalize subject line
- No period at end of subject
- Limit subject to 50 characters
- Wrap body at 72 characters
- Reference related issues

## Pull Request Process

**Only for the branch case above.** Day-to-day work is committed straight to
`main` -- see [Committing](#committing) -- and the checks in this section are
worth running either way. `bash RUN_TESTS.sh` from the repo root runs the lot.

### Before Creating a PR

1. **Update your branch with main**
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run all tests**
   ```bash
   # Backend
   cd backend && pytest --cov
   
   # Frontend
   cd frontend && npm test
   ```

3. **Run linters**
   ```bash
   # Backend
   cd backend && black . && flake8 . && mypy .
   
   # Frontend
   cd frontend && npm run lint
   ```

4. **Ensure your code builds**
   ```bash
   # Backend should start without errors
   uvicorn main:app --reload
   
   # Frontend should build
   npm run build
   ```

### Creating the PR

1. Push your branch to GitHub
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request with:
   - Clear title describing the change
   - Description of what changed and why
   - Link to related issue(s): `Fixes #123`
   - Test coverage information
   - Any breaking changes documented

3. PR Title Format:
   ```
   [Type] Brief description (e.g., [FEAT] Add user authentication)
   ```

### PR Checklist

- [ ] Code follows style guidelines
- [ ] All tests pass locally
- [ ] New code has tests
- [ ] Documentation is updated
- [ ] No debug code or console.logs
- [ ] Commit messages are clear
- [ ] No hardcoded secrets or credentials

### Review Process

- At least one approval required before merge
- Automated tests must pass
- Code style checks must pass
- All conversations resolved

## Questions?

- Check existing [Issues](https://github.com/dhuber24/horse-show-results-app/issues)
- Open a new [Issue](https://github.com/dhuber24/horse-show-results-app/issues/new) for questions
- Check [CLAUDE.md](./CLAUDE.md) for design decisions and architecture overview

---

Thank you for contributing to Horse Show Results App! 🎉
