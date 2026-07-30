---
name: run-app
description: Build, run, and drive the Horse Show Results app (Next.js frontend + FastAPI backend via Docker Compose, against Neon Postgres). Use when asked to start the app, launch it, run it locally, register/log in as an exhibitor, click through the UI, take a screenshot, or verify a change works end-to-end (not just tests/typecheck).
---

This is a two-container web app (Next.js frontend on :3000, FastAPI backend
on :8000) run with `docker-compose up`, backed by a single **Neon Postgres**
database — there is no local DB container, `DATABASE_URL` in `.env` points
straight at Neon. Drive it with the Playwright REPL driver at
`.claude/skills/run-app/driver.mjs` (no `chromium-cli`
binary is installed on this machine, so this driver stands in for it — same
command style: `nav` / `wait-for` / `click` / `fill` / `screenshot`).

All paths below are relative to the repo root.

## Prerequisites

- Docker Desktop (Windows). If `docker ps` fails with `dockerDesktopLinuxEngine`
  pipe errors, the daemon isn't running yet — launch it and poll:

  ```bash
  "/c/Program Files/Docker/Docker/Docker Desktop.exe" &
  until docker ps >/dev/null 2>&1; do sleep 5; done
  ```

  It's ready ~10-30s after launch.
- `.env` at repo root must already have `DATABASE_URL`, `INTERNAL_API_KEY`,
  `NEXTAUTH_SECRET` filled in (copy from `.env.example` otherwise). This repo
  already had a real one pointed at Neon dev.
- Node 20+/npm on the host, for the driver only (the app itself runs inside
  containers).

## Setup (driver, one-time)

The driver has its own tiny `package.json` in the skill dir so Playwright
isn't added to the product's `frontend/package.json`:

```bash
cd .claude/skills/run-app
npm install
npx playwright install chromium chromium-headless-shell
```

(Both browser downloads are required — newer Playwright launches
`chrome-headless-shell` by default for headless mode, `chromium` alone is not
enough and you'll get "Executable doesn't exist" at launch.)

## Build & Run

```bash
docker compose up -d --build
```

Wait for health, then confirm both are answering:

```bash
curl -sf http://localhost:8000/                                    # {"status":"ok","app":"Horse Show Results API"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/     # 200
docker compose ps                                                   # both "healthy"/"Up"
```

Stop with `docker compose down` (or leave it running — that's the normal
local dev state per the project README).

Migrations: `powershell -ExecutionPolicy Bypass -File database/migrate.ps1`
(applies anything unapplied in `database/migrations/` to Neon — didn't need
to run this, DB was already current).

## Run (agent path) — driving the UI

```bash
cd .claude/skills/run-app
node driver.mjs <<'EOF'
nav http://localhost:3000/register
wait-for text=Create Account
sleep 1500
fill input[name="first_name"] Skill
fill input[name="last_name"] TestUser
fill input[name="email"] e2e-skill-test-UNIQUE@example.com
fill input[name="password"] TestPass1234!
fill input[name="confirm_password"] TestPass1234!
screenshot register-filled
click button:has-text("Create Account")
wait-for text=Upcoming Shows
screenshot dashboard
console-errors
quit
EOF
```

Replace `UNIQUE` with something fresh each run (e.g. `` `date +%s` ``) — the
email is the login identifier and registration 409s on a duplicate.
Screenshots land in `.claude/skills/run-app/screenshots/`
(latest of each name overwrites; `screenshot.png` always has the most recent
shot of the whole session).

This exact flow was run and verified: it registers a real `EXHIBITOR` user,
signs in via NextAuth, and lands on the "Upcoming Shows" dashboard showing
the seeded show ("North Country Classic"). `console-errors` reported none.

Driver commands:

| command | what it does |
|---|---|
| `nav <url>` | navigate |
| `wait-for text=<substring>` or `wait-for <css selector>` | wait up to 30s for visible |
| `wait-url <substring>` | wait up to 30s for `page.url()` to contain substring |
| `click <css selector>` | click (supports `text=...` too) |
| `fill <css selector> <value...>` | fill an input (goes through real input events, not `.value=`) |
| `press <key>` | keyboard press, e.g. `Enter` |
| `screenshot [name]` | full-page PNG, default name `shot-NN` |
| `console-errors` | dump any `console.error`/`pageerror` seen so far |
| `eval <js>` | `page.evaluate(...)`, prints JSON result |
| `sleep <ms>` | raw wait, use sparingly — prefer `wait-for` |
| `quit` | close browser and exit |

For iterative debugging, run `node driver.mjs` without a heredoc and type
commands interactively, or wrap it in tmux and `send-keys` one line at a
time.

## Direct invocation — backend only

Most backend-only PRs don't need a browser at all. The backend is a plain
FastAPI service; hit it with curl, and for endpoints behind auth, use the
same `X-API-Key`/`X-User-Id`/`X-User-Role` headers the frontend route
handlers attach (see `backend/dependencies.py`, `docs/auth.md`):

```bash
curl -sf http://localhost:8000/                                    # public health check
curl -s -X POST http://localhost:8000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"someone@example.com","password":"..."}'            # {"detail":"Invalid credentials"} if wrong
```

The Next.js route-handler layer (`frontend/app/api/*`) can also be curled
directly once the frontend container is up, e.g.
`POST http://localhost:3000/api/auth/register` — this is what the browser
driver's registration step ends up calling.

## Run (human path)

`docker compose up` (no `-d`) → open http://localhost:3000 in a real browser.
`Ctrl-C` to stop.

## Test

```bash
cd frontend && npm run type-check   # tsc --noEmit — passed clean
python -m compileall backend -q     # backend syntax check — passed clean
```

Full suite (frontend build+lint+tests, backend compile) is
`bash RUN_TESTS.sh` from repo root — not re-run here since type-check and
compileall already cover the fast path; it takes longer (full `next build`).

## Gotchas

- **Next.js dev-mode first-compile latency is real, not a bug.** The
  redirect from `/register` → `/` after a successful registration can take
  15-25s the first time, because Next compiles the dashboard route on
  demand. `wait-for`/`wait-url` default to 30s for exactly this reason —
  don't shorten them, and don't `sleep 2000` and assume something's broken
  when the form still shows "Creating account...".
- **Click/fill too early after `nav` silently no-ops.** If you interact
  with `/register` before React has finished hydrating, Playwright's
  `fill()` sets the DOM value but React's controlled state never updates —
  the input *looks* filled in a screenshot taken right after, then resets to
  empty on the next re-render, and the submit button's `onClick` doesn't
  fire at all (no network request happens). Fix: `wait-for` a stable text
  node first, then add a short `sleep 1500` before the first `fill`, as in
  the example above.
- **A benign hydration-mismatch warning fires on every page with the
  inline-styled `RegisterForm` inputs** (`borderColor`/`backgroundColor` vs.
  browser-normalized `border-*-color` longhand). It shows up under
  `console-errors` but is pre-existing/cosmetic, not something this driver
  caused — don't treat it as a failure signal on its own.
- **Registration writes to the real Neon database** — there's no separate
  local/test Postgres (see `CLAUDE.md`: "There is no local Postgres
  service"). Every driver run that registers a user leaves a real row in
  `users`/`exhibitors` unless you delete it. Use an obviously-disposable
  email (`e2e-skill-test-<timestamp>@example.com`) and clean up after
  yourself:

  ```bash
  DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r' | sed 's/postgresql+asyncpg/postgresql/')
  docker run --rm postgres:16-alpine psql "$DBURL" -c \
    "DELETE FROM exhibitors WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-skill-test-%@example.com');"
  docker run --rm postgres:16-alpine psql "$DBURL" -c \
    "DELETE FROM users WHERE email LIKE 'e2e-skill-test-%@example.com';"
  ```
- **Headless launch needs `chromium-headless-shell`, not just `chromium`.**
  `npx playwright install chromium` alone leaves
  `chrome-headless-shell.exe` missing and `chromium.launch({headless:true})`
  throws immediately. Install both (see Setup).
- **`docker compose up -d --build`** is fast on a warm cache (~1s, layers
  cached) but the very first build pulls `node:20-alpine` etc. — budget a
  few minutes cold.

## Troubleshooting

- **`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`**:
  Docker Desktop isn't running. Launch it (see Prerequisites) and poll
  `docker ps` until it succeeds instead of a fixed sleep.
- **`browserType.launch: Executable doesn't exist at
  ...chromium_headless_shell-.../chrome-headless-shell.exe`**: run
  `npx playwright install chromium chromium-headless-shell` in the skill
  dir (see Gotchas above).
- **Registration form stuck on "Creating account..." forever, no console
  error**: almost always the hydration-timing issue above, not a real bug —
  add the `sleep 1500` after the first `wait-for` and retry before assuming
  something's broken.
