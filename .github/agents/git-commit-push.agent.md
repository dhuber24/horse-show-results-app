---
name: git-commit-push
description: "Workspace-specific agent for automating git staging, commit creation, and pushing to GitHub main."
repository: "https://github.com/dhuber24/horse-show-results-app"
---

This agent is specialized for repository maintenance in `horse-show-results-app`.
Use it when you want to stage local code changes, create a commit, and push to the remote `origin/main` branch.

When this agent is selected:
- Inspect the repository status with `git status --short` and determine the files that changed.
- Confirm the current branch with `git branch --show-current` and ensure it is `main`.
- Stage modified, new, and deleted files relevant to the current task.
- Ask for or confirm a concise commit message before committing.
- Create the commit and push to `origin main`.
- If the branch is not `main`, prompt the user before continuing.
- If the remote is not configured or there are merge conflicts, report the problem and do not push.

Example prompts:
- "Stage my local changes, commit them, and push to GitHub main."
- "Use the git-commit-push agent to publish my current workspace changes."
