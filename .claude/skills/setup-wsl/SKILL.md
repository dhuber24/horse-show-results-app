---
name: setup-wsl
description: Move a Windows developer machine onto the fast setup — a clone inside WSL Ubuntu's own filesystem, run with Docker Desktop's WSL integration and Turbopack — and verify it end to end. Use when asked to set up a new dev machine, onboard a developer, move to WSL or Ubuntu, make another machine as fast as this one, or when the app is slow, hot reload needs polling, or Turbopack never sees an edit on a C:\ checkout.
---

A checkout on a Windows drive (`C:\...`) is the slow way to run this stack.
Docker's Linux VM reads `./frontend` and `./backend` through a file-sharing
layer that is slow for the thousands of small files `next dev` touches, and it
delivers no file events, so the watcher has to poll and Turbopack can't be
used. On the first machine moved, the same seven cold pages went from 82 s to
37 s, warm pages from about 3 s to under 1 s, and hot reload became instant.

The fix is **where the code lives**, not which Docker runs it. **Docker
Desktop stays installed and running.** Ubuntu's `docker` command is Docker
Desktop's client, provided through WSL integration, and `release.ps1`,
`copy-prod-to-dev.ps1` and the release skill all call `docker` from Windows.
Don't install Docker Engine (`docker-ce`) inside Ubuntu as part of this skill.

`scripts/setup-wsl.sh` does the installing, and it's safe to run again. This
skill checks that the prerequisites are in place, hands the script to the
user, verifies what it did, and moves the running stack over. If the script
fails on a step, fix the **script**, so the next machine gets the fix too (the
way PowerShell's tarball fallback was added for Ubuntu 26.04). Don't patch the
machine by hand and leave the script broken.

## 0. Where are we running?

```bash
grep -qi microsoft /proc/version 2>/dev/null && echo wsl || echo windows
```

- **`wsl`, in `~/projects/...`:** the clone already exists. Skip to step 4 and
  verify it. Rerun the script only if something is missing.
- **`windows`** (Git Bash, in the `C:\` checkout): start at step 1. Put
  `MSYS_NO_PATHCONV=1` in front of every `wsl.exe` call. Otherwise Git Bash
  rewrites `/mnt/c/...` and `/home/...` arguments into Windows paths. Pipe
  `wsl.exe -l` output through `tr -d '\0\r'`, because it prints UTF-16.

## 1. Bring the Windows checkout up to date

The script clones from `origin`, not from the Windows checkout, so any work
that exists only on this machine stays behind. Check:

```bash
git status --short
git fetch origin && git log --oneline origin/main..HEAD
```

If there are uncommitted changes or unpushed commits, list them and ask the
user what to do. **Don't push them to get them across.** A push to `main` is a
production deploy (see `git-commit-push`), and the user runs releases. One
safe option is to copy the files over after step 3. Another is to commit them
now and push only when the user says so.

## 2. Check prerequisites (Windows)

```bash
wsl.exe -l -v | tr -d '\0\r'
docker version --format '{{.Server.Platform.Name}}'
```

- **No `Ubuntu*` distro in the list:** the user has to install one. It needs an
  elevated prompt, sometimes a reboot, and an interactive username and
  password. Tell them to run `wsl --install -d Ubuntu` in an admin PowerShell
  and create their Linux user. Then stop until they're back. Use whatever name
  the distro shows up with (`Ubuntu`, `Ubuntu-24.04`, ...) as `-d` from here
  on.
- **A distro at VERSION 1:** `wsl --set-version <name> 2`. Docker integration
  needs WSL 2.
- **Docker unreachable:** start Docker Desktop
  (`"/c/Program Files/Docker/Docker/Docker Desktop.exe" &`, then poll
  `docker ps`). If it isn't installed, stop and say so.
- **Docker reachable from Ubuntu?**
  `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- docker version --format '{{.Server.Platform.Name}}'`.
  If that fails, the user has to turn it on: Docker Desktop → Settings →
  Resources → WSL integration → switch the distro on → Apply & restart. It's a
  GUI toggle, so ask them to do it instead of editing Docker's settings files.

## 3. Run the setup script (the user does this)

The script uses `sudo`, which asks for the Linux password, so Claude can't run
it through `wsl.exe`. Work out the `/mnt/c/...` path of this checkout (in Git
Bash, `pwd` gives `/c/Users/...`, which becomes `/mnt/c/Users/...`). Then give
the user the exact command to paste into an **Ubuntu terminal**:

```bash
bash /mnt/c/Users/<them>/projects/horse-show-results-app/scripts/setup-wsl.sh
```

It installs git, curl, PowerShell, the GitHub CLI, and nvm with the Node
version the Dockerfile pins. It copies the git identity from the Windows
checkout and uses Windows' Git Credential Manager for pushes. It clones into
`~/projects/horse-show-results-app` with the repo's hooks, copies `.env` with
CRLF stripped, `NEXT_DEV_FLAGS=--turbopack` and `WATCHPACK_POLLING=false`, and
runs `npm ci` for the host. It also copies Claude Code's project memory and
user settings to the new path. `WIN_REPO=` and `DEST=` override the source and
destination.

Wait for the user to paste the output or say it finished. If it stopped on an
error, read the failing step in `scripts/setup-wsl.sh`, fix the script, and
have them run it again. Every step checks before it acts, so a rerun picks up
where it stopped.

## 4. Verify

From Windows:

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc 'bash ~/projects/horse-show-results-app/.claude/skills/setup-wsl/verify.sh'
```

From inside Ubuntu, run `bash .claude/skills/setup-wsl/verify.sh` instead.

Every line should have a real value. Handle anything that doesn't:

| Line | Problem | Fix |
| --- | --- | --- |
| `pwsh`, `gh`, `node`, `npm` | `MISSING` | Rerun the script. If it fails again, fix that step in the script. |
| `node` | wrong version | `nvm install <v> && nvm alias default <v>` in Ubuntu. |
| `hooks` | `unset` | `git config core.hooksPath .githooks` in the clone. Without it, the pre-commit docs guard doesn't run. |
| `flags` | blank | The `.env` was copied without them. Append `NEXT_DEV_FLAGS=--turbopack` and `WATCHPACK_POLLING=false`. These are the only `.env` lines you may add. |
| `secrets` | `EMPTY: ...` | No `.env` existed to copy, so it came from `.env.example`. The user fills in the values themselves. **Never read out or print `.env` values**, and don't fetch secrets from Render or Neon without being asked. |
| `docker` | `UNREACHABLE` | WSL integration is off for this distro (step 2), or the terminal predates it. Ubuntu 26.04 has no `newgrp`, so reopen the terminal. |

## 5. Move the running stack

Both checkouts use the same compose project name, container names and ports,
so **only one stack can run**. Tell the user before you stop the Windows one.
Stopping it is reversible, but it's their running app.

```bash
docker compose down        # in the Windows checkout
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc 'cd ~/projects/horse-show-results-app && docker compose up -d --build -V'
```

`-V` gives the frontend a fresh `node_modules` volume instead of reusing the
one built from the Windows checkout. Then confirm:

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc 'cd ~/projects/horse-show-results-app && docker compose ps --format "{{.Service}} {{.State}} {{.Health}}" && docker compose logs frontend 2>&1 | grep -m1 "Next.js"'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```

The backend should be `healthy`, the Next.js banner should say `(Turbopack)`,
and the curl should return `200` (WSL forwards localhost to Windows). If the
backend doesn't become healthy, `docker compose logs --tail=50 backend` usually
points to `.env` (an empty `DATABASE_URL`) or schema drift. For schema drift,
run `pull-latest`'s migration step from the clone.

## 6. Hand off

Tell the user what's left. Claude can't do these:

1. `code ~/projects/horse-show-results-app` from Ubuntu. VS Code installs its
   WSL server the first time. Work from that window from now on, not from
   `\\wsl$\...` in Explorer, which goes back through the slow layer.
2. Sign in to Claude Code again in the WSL window. Project memory has already
   been copied to the new path.
3. Run `gh auth login` once in Ubuntu.
4. Retire the `C:\` checkout. It goes stale from here on, and starting its
   stack again collides with the WSL one. Keep it if the PowerShell release
   scripts are run from Windows. Otherwise it can be deleted once nothing is
   left only there.

Report what you verified (the step 4 table, a healthy stack on Turbopack,
HTTP 200) and anything you fixed in `scripts/setup-wsl.sh` along the way. A
script fix is a change to commit. Mention it, and commit only when asked.
