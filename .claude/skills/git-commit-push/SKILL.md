---
name: git-commit-push
description: Stage, docs-guard-check, commit, and push the current changes to origin/main in this repo. Use when asked to commit changes, save work, or "commit and push" — this repo commits straight to main, there is no feature-branch/PR workflow in practice.
---

This repo's actual workflow is **direct-to-main**: every commit in `git log`
lands on `main` and gets pushed to `origin/main` immediately. `CONTRIBUTING.md`
describes a feature-branch/PR process, but it isn't followed — don't create
branches or PRs unless the user explicitly asks for that instead of the normal
flow. There's already a workspace agent (`.github/agents/git-commit-push.agent.md`)
and script (`scripts/run-git-commit-push.ps1`) encoding this same procedure;
this skill is the Claude Code path to the same result.

## Preconditions

- Only commit when the user asks. Only push when the user asks to push/publish
  — a bare "commit" request should stop after the commit.
- Confirm the branch is `main`: `git branch --show-current`. If it isn't,
  stop and ask the user before continuing — don't push a non-`main` branch to
  `origin main` and don't switch branches on your own.

## Steps

1. **Inspect.** Run in parallel: `git status --short`, `git diff` (unstaged +
   staged), `git log -5 --format="%H %s"` (style reference).
2. **Stage.** Prefer adding specific paths over `git add -A` so nothing
   unintended rides along. If you do need everything changed, review
   `git status` after staging and double-check any file that looks like it
   could hold secrets before proceeding. `.claude/scheduled_tasks.lock`, if
   present and staged, should be unstaged — it's local scheduler state, not
   project content: `git restore --staged .claude/scheduled_tasks.lock`.
3. **Run the documentation guard** — it blocks staged implementation/DB/
   runtime/frontend changes without a matching docs update:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/check-docs-updated.ps1
   ```
   If it fails, update the relevant doc (`CLAUDE.md`, `docs/*`,
   `database/README.md`, `frontend/README.md`) and stage that too, then
   re-run. Only bypass with `DOCS_CHECK_BYPASS=1 git commit ...` if the user
   explicitly approves skipping it for this commit.
4. **Write the commit message** matching actual repo style (not
   `CONTRIBUTING.md`'s `<type>(<scope>)`/`Fixes #` template, which isn't what's
   used):
   - Subject: `type: short imperative summary` — e.g. `feat: ...`, `fix: ...`,
     `chore: ...`, `docs: ...`. No scope parens, no issue references (this
     repo doesn't use one).
   - Body (when the change isn't trivial): a `-` bullet per notable change,
     wrapped near 72-80 cols.
   - Footer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (swap
     in whichever Claude model is actually doing the work, matching history).
5. **Commit.** On Windows, PowerShell 5.1's native-arg splatting
   (`& git @GitArgs`) splits multi-line strings on newlines, and
   `Out-File -Encoding utf8` adds a BOM — both corrupt a multi-line `-m`
   message (see commit `4610dd5`). Avoid both by writing the message to a temp
   file with no-BOM UTF-8 and committing with `-F`:
   ```powershell
   $tmp = New-TemporaryFile
   [System.IO.File]::WriteAllText($tmp.FullName, $Message, (New-Object System.Text.UTF8Encoding($false)))
   git commit -F $tmp.FullName
   Remove-Item $tmp.FullName -Force
   ```
   From the Bash tool a heredoc works fine and doesn't need this workaround:
   ```bash
   git commit -F - <<'EOF'
   feat: subject line

   - bullet
   - bullet

   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   EOF
   ```
6. **Sync before pushing** (only if asked to push). Working across two
   machines means `origin/main` may have moved ahead of local `main` — always
   check, don't assume you're first:
   ```bash
   git fetch origin main
   git log HEAD..origin/main --oneline   # anything printed means origin is ahead
   ```
   If origin is ahead, rebase the local commit(s) on top rather than merging —
   this repo's history has no merge commits, keep it linear:
   ```bash
   git rebase origin/main
   ```
   - **Clean rebase:** proceed to push.
   - **Conflicts:** rebase stops and lists conflicting files
     (`git status` shows `both modified`). Resolve them in the working tree,
     `git add <file>` per resolved file, then `git rebase --continue`. Don't
     guess silently on a conflict that changes logic/behavior — show the user
     both sides and confirm the resolution before continuing, especially for
     migrations or schema files where picking the wrong side can drop a
     column or reorder a migration number.
   - If a rebase gets messy, `git rebase --abort` is always safe (returns to
     the pre-rebase state) — use it rather than pushing through a bad
     resolution.
7. **Push:** `git push origin main`. If it's still rejected after the sync
   step above (someone pushed again in the gap), repeat step 6 — don't force
   push.
8. **Report** the commit SHA and `git status` (clean or not) back to the
   user.

Note: `scripts/run-git-commit-push.ps1` does **not** do this fetch/rebase
sync — it goes straight to `git push origin main` and will simply fail with a
non-fast-forward error if the other machine pushed first. Use the manual
steps above (or extend the script, if asked) when working across two
machines; don't rely on the script alone for that case.

## Shortcut: the existing script

For the common case (stage everything relevant, guard, commit, push, all in
one go), the repo's own script does steps 2-6 with the same rules baked in:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-git-commit-push.ps1 -Message "feat: subject line"
```

It refuses to run from any branch but `main`, restages around
`.claude/scheduled_tasks.lock` automatically, runs the docs guard, and always
pushes to `origin main` at the end — use it when the user wants the full
commit+push in one step and hasn't asked for finer control over what gets
staged.

## Gotchas

- Never use `--no-verify`, `--no-gpg-sign`, or `-c commit.gpgsign=false`
  unless the user explicitly asks — that skips the docs guard hook.
- Never `--amend` a commit that's already been pushed; make a new commit
  instead.
- Never force-push `main`.
