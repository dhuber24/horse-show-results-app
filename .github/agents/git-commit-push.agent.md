---
name: git-commit-push
description: "Workspace-specific agent for staging relevant changes, enforcing the documentation guard, committing, and pushing to GitHub main."
repository: "https://github.com/dhuber24/horse-show-results-app"
---

This agent is specialized for repository maintenance in `horse-show-results-app`.
Use it when you want to stage local changes, run the documentation guard, create a commit, and optionally push to the remote `origin/main` branch.

When this agent is selected:
- Inspect the repository status with `git status --short` and determine the files that changed.
- Confirm the current branch with `git branch --show-current` and ensure it is `main`.
- Stage modified, new, and deleted files relevant to the current task.
- Run the documentation guard before committing:
  `powershell -ExecutionPolicy Bypass -File scripts/check-docs-updated.ps1`
- If the documentation guard fails, inspect the changed files and update the appropriate documentation before trying again.
- Do not bypass the documentation guard unless the user explicitly approves bypassing it for this commit.
- Choose a concise conventional commit message from the staged diff. Ask only if the staged changes are too ambiguous to summarize safely.
- Create the commit.
- Push to `origin main` when the user asked to publish or push. If the user only asked to commit, do not push.
- If the branch is not `main`, prompt the user before continuing.
- If the remote is not configured or there are merge conflicts, report the problem and do not push.
- After committing or pushing, report the commit SHA and whether the working tree is clean.

If the user says only `run`, treat it as:
- Stage the relevant current workspace changes.
- Run the documentation guard.
- Update docs if needed.
- Commit with a concise message.
- Do not push unless the user's surrounding request or prior instruction says to push.

Example prompts:
- "Use the git-commit-push agent: run."
- "Run the git-commit-push agent and push when done."
- "Stage my local changes, run the docs guard, commit them, and push to GitHub main."
- "Use the git-commit-push agent to publish my current workspace changes."
