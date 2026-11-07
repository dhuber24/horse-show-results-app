---
name: pull-latest
description: Pull the latest code from origin/main into this local checkout and bring the local environment up to date with it — dev migrations, Docker rebuilds, frontend dependencies. Use when asked to pull, sync, update local, get the latest, catch up with the other machine, or "pull in my remote codebase".
---

This repo is worked on from more than one machine and commits straight to
`main` (see the `git-commit-push` skill), so `origin/main` is often ahead of
local. Pulling the commits is half the job. What they changed decides what
else has to happen locally: a migration has to reach the dev database, a new
Python dependency needs a backend image rebuild, and a new npm package needs
the frontend's `node_modules` volume rebuilt. Otherwise the app runs new code
against old dependencies and fails in ways that point somewhere else.

**This skill only reads from the remote. It never pushes, and it never touches
production.** A push is a deploy (see `git-commit-push`), and the user runs
releases themselves.

All paths are relative to the repo root. Commands are Bash (Git Bash) unless
marked PowerShell.

## 1. Check where local stands

Run these in parallel:

```bash
git branch --show-current
git status --short
git fetch origin
```

- **Not on `main`:** stop and ask. Don't switch branches without being asked.
- **Uncommitted changes:** don't stash, reset or discard them without asking.
  List the files and ask whether to commit them first (with `git-commit-push`,
  without pushing), stash them for the pull, or leave them and stop. If the
  user picks stash, use `git stash push -u -m "pull-latest <date>"` and restore
  it with `git stash pop` once step 3 is done. If the pop conflicts, show the
  user both sides; don't settle it yourself.
- `.claude/scheduled_tasks.lock` showing as changed is local scheduler state.
  Ignore it. It doesn't count as a dirty tree.

## 2. See what's coming

```bash
OLD=$(git rev-parse HEAD)
git log --oneline HEAD..origin/main   # incoming commits
git log --oneline origin/main..HEAD   # local commits not on origin
```

- **No incoming commits:** say local is already up to date and stop. Skip the
  rest.
- Record `OLD`. Step 4 decides what to do from the files changed since it.

## 3. Pull

- **No local commits ahead:** fast-forward.
  ```bash
  git merge --ff-only origin/main
  ```
- **Local commits ahead:** rebase them on top. History here is linear, with no
  merge commits.
  ```bash
  git rebase origin/main
  ```
  If the rebase stops on a conflict, show the user both sides of anything that
  changes behaviour and confirm before `git add` and `git rebase --continue`.
  Take extra care with `database/migrations/`, `backend/models.py` and
  `backend/schemas.py`: picking the wrong side can drop a column or produce two
  migrations with the same number. `git rebase --abort` always gets you back to
  where you started. Don't push afterwards. Say the local commits are now
  rebased and still unpushed.

## 4. Bring the environment up to date

List what changed:

```bash
git diff --name-only "$OLD" HEAD
```

Then handle each case that applies, in this order:

| Changed | Do |
| --- | --- |
| `database/migrations/*` | Apply them to **dev** (below). |
| `backend/requirements.txt`, `backend/Dockerfile` | `docker-compose build backend` |
| `frontend/package.json`, `frontend/package-lock.json`, `frontend/Dockerfile` | `docker-compose build frontend`, then `cd frontend && npm ci` for the host's own `node_modules` (type-check, lint and tests run on the host) |
| `docker-compose.yml` | Recreate the containers (below). |
| `.env.example` | Diff its variable names against `.env` and tell the user which are missing. **Never edit `.env`, and never print its values.** |
| Anything else in `backend/` or `frontend/` | Nothing to do. Uvicorn runs with `--reload`, and Next reloads by polling. |

### Migrations go to dev only

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

- **Never pass `-AllowProduction`.** The runner prints its target before it
  runs anything. If it refuses because the target is production, stop and tell
  the user: `$env:DATABASE_URL` in this shell points at production, so it
  overrides `.env`.
- The output must end with `Migrations complete.`. Every new migration shows as
  `applying:` or `skipped:`. A dev branch shared with the other machine often
  already has them (`skipped:`), and that's fine.
- If one fails, stop and report the error. Don't edit an applied migration;
  migrations are append-only.

### Restart what's running

Check `docker-compose ps`. If the containers aren't running, the rebuilt
images are used the next time the app starts, so say so and stop there.

If they are running:

- **Backend rebuilt:** `docker-compose up -d backend`
- **Frontend rebuilt:** `docker-compose up -d -V frontend`. The `-V` matters.
  `/app/node_modules` is an anonymous volume, and a plain `up` reuses the old
  one, so the new image's packages never appear and imports fail with "Module
  not found".
- **`docker-compose.yml` changed:** `docker-compose up -d -V`

Afterwards, wait for `docker-compose ps` to show the backend as `healthy`, then
check that `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
returns 200. If the backend won't become healthy after a migration, check
`docker-compose logs --tail=50 backend` for a schema-drift message
(`backend/schema_drift.py`). That usually means a migration didn't apply.

## 5. Report

Keep it short:

- How many commits were pulled, and their subject lines (or the top few if
  there are many).
- What step 4 did: migrations applied or skipped, images rebuilt, containers
  restarted, `npm ci` run.
- Anything the user still has to do, such as missing `.env` variables, a stash
  still waiting to be popped, or local commits still unpushed.
- If an incoming commit carries a migration, mention whether it's also been
  released to production. Don't check production or run a release from here.
  Just say it, so a pending release isn't forgotten.
