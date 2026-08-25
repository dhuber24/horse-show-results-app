#!/bin/bash
# Run every automated check in this repo.
#
# Deliberately does NOT use `set -e`: the point is to run all four checks and
# report which ones failed, not to stop at the first. Each check's exit status
# is captured immediately, because anything at all between the command and
# reading `$?` — including a counter increment — resets it. The previous
# version of this script read `$?` after `TOTAL=$((TOTAL + 1))` and therefore
# reported PASS unconditionally; it could not fail.
#
# `npm run build` is deliberately absent. The host and the dev container share
# frontend/.next through a bind mount, so a host-side build breaks the running
# dev server. CI builds instead, where there is nothing to clobber.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_IMAGE="horse-show-results-app-backend:latest"

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

FAILED=0
SUMMARY=""

record() {
  # record <status> <name>
  if [ "$1" -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}: $2"
    SUMMARY="${SUMMARY}\n  ${GREEN}PASS${NC}  $2"
  else
    echo -e "${RED}FAIL${NC}: $2"
    SUMMARY="${SUMMARY}\n  ${RED}FAIL${NC}  $2"
    FAILED=$((FAILED + 1))
  fi
}

echo -e "${BLUE}=== Horse Show Results — test suite ===${NC}"

# ── Backend ───────────────────────────────────────────────────────────────────
# Runs in the backend image, not on the host: the backend needs Python 3.10+
# (it uses `X | None` annotations at runtime) and the host interpreter is 3.9.
# `py -m compileall` passes there only because it byte-compiles without
# importing. ./backend is mounted so host-side edits need no rebuild.
echo -e "\n${BLUE}--- Backend (pytest, in Docker) ---${NC}"
if ! docker image inspect "$BACKEND_IMAGE" >/dev/null 2>&1; then
  echo -e "${RED}Backend image '$BACKEND_IMAGE' not found.${NC} Build it with: docker-compose build backend"
  record 1 "Backend tests (pytest)"
else
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "${PROJECT_ROOT}/backend:/app" \
    -w /app \
    "$BACKEND_IMAGE" \
    python -m pytest -p no:cacheprovider
  record $? "Backend tests (pytest)"
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT/frontend" || exit 1

echo -e "\n${BLUE}--- Frontend type check ---${NC}"
npm run type-check
record $? "Frontend type check (tsc --noEmit)"

echo -e "\n${BLUE}--- Frontend lint ---${NC}"
npm run lint
record $? "Frontend lint (next lint)"

echo -e "\n${BLUE}--- Frontend tests ---${NC}"
npm test -- --ci
record $? "Frontend tests (jest)"

# ── Result ────────────────────────────────────────────────────────────────────
echo -e "\n${BLUE}=== Summary ===${NC}${SUMMARY}"
if [ "$FAILED" -gt 0 ]; then
  echo -e "\n${RED}${FAILED} check(s) failed.${NC}"
  exit 1
fi
echo -e "\n${GREEN}All checks passed.${NC}"
