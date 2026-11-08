#!/bin/bash
# Checks that scripts/setup-wsl.sh left a working WSL dev checkout. Read-only.
# Prints one line per check; anything MISSING, EMPTY, UNREACHABLE or unset
# needs fixing. Never prints .env values, only whether the keys are filled in.
#
#   bash .claude/skills/setup-wsl/verify.sh            (inside Ubuntu)
#   DEST=/some/other/clone bash .../verify.sh

D="${DEST:-$HOME/projects/horse-show-results-app}"
# nvm's Node is not on PATH in a non-interactive shell (wsl.exe -- bash -lc).
. "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

row() { printf '%-10s %s\n' "$1" "$2"; }

row wsl     "$(grep -qi microsoft /proc/version && echo yes || echo 'NOT WSL')"
row pwsh    "$(pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>/dev/null || echo MISSING)"
row gh      "$(gh --version 2>/dev/null | head -1 || echo MISSING)"
row node    "$(node --version 2>/dev/null || echo MISSING) (want v$(grep -m1 -o 'NODE_VERSION=[0-9.]*' "$D/scripts/setup-wsl.sh" 2>/dev/null | cut -d= -f2))"
row git     "$(git config --global user.name) <$(git config --global user.email)>"
row cred    "$(git config --global credential.helper || echo 'unset (push will prompt; gh auth login also works)')"
row clone   "$(git -C "$D" rev-parse --short HEAD 2>/dev/null || echo MISSING) on $(git -C "$D" branch --show-current 2>/dev/null)"
row hooks   "$(git -C "$D" config core.hooksPath || echo unset)"
row env     "$([ -f "$D/.env" ] && echo present || echo MISSING)"
row flags   "$(grep -E '^(NEXT_DEV_FLAGS|WATCHPACK_POLLING)=' "$D/.env" 2>/dev/null | tr '\n' ' ')"
missing=""
for k in DATABASE_URL INTERNAL_API_KEY NEXTAUTH_SECRET; do
  grep -qE "^$k=.+" "$D/.env" 2>/dev/null || missing="$missing $k"
done
row secrets "$([ -n "$missing" ] && echo "EMPTY:$missing" || echo 'filled in')"
row npm     "$([ -d "$D/frontend/node_modules" ] && echo 'node_modules present' || echo MISSING)"
row docker  "$(docker version --format '{{.Server.Platform.Name}}' 2>/dev/null || echo UNREACHABLE)"
