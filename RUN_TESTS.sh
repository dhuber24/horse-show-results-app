#!/bin/bash
# Phase 2 Testing Suite - Run locally
# This script tests all remaining improvements

set -e  # Exit on first error

PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESULTS_FILE="$PROJECT_ROOT/TEST_RESULTS.md"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Clear previous results
> "$RESULTS_FILE"

echo -e "${BLUE}=== Phase 2 Testing Suite ===${NC}"
echo -e "${BLUE}Date: $(date)${NC}\n"

echo "# Phase 2 Testing Results - $(date '+%B %d, %Y')" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

# Test Counter
TOTAL=0
PASSED=0
FAILED=0

test_result() {
  TOTAL=$((TOTAL + 1))
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: $1"
    echo "- [x] $1 ✅" >> "$RESULTS_FILE"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}❌ FAIL${NC}: $1"
    echo "- [ ] $1 ❌" >> "$RESULTS_FILE"
    FAILED=$((FAILED + 1))
  fi
}

# ============================================================
# SECTION 1: Static Code Analysis
# ============================================================
echo -e "\n${BLUE}--- Static Code Analysis ---${NC}\n"

# Test 1: Type Checking
echo "Running TypeScript type check..."
cd "$PROJECT_ROOT/frontend"
npm run type-check > /dev/null 2>&1
test_result "TypeScript Type Check (npm run type-check)"

# Test 2: ESLint
echo "Running ESLint..."
npm run lint > /dev/null 2>&1
test_result "ESLint (npm run lint)"

# Test 3: Frontend Build
echo "Building frontend..."
npm run build > /dev/null 2>&1
test_result "Frontend Build (npm run build)"

# ============================================================
# SECTION 2: Code Verification
# ============================================================
echo -e "\n${BLUE}--- Code Verification ---${NC}\n"

cd "$PROJECT_ROOT"

# Test 4: Controlled Selects
grep -q "selectedAdminId.*useState" frontend/app/admin/shows/\[id\]/ShowStaffPanel.tsx
test_result "Controlled Selects in ShowStaffPanel"

grep -q "selectedKeeperId.*useState" frontend/app/admin/shows/\[id\]/ShowStaffPanel.tsx
test_result "Controlled Keeper Select in ShowStaffPanel"

grep -q "selectedUserId.*useState" frontend/app/admin/venues/\[id\]/VenueAdminPanel.tsx
test_result "Controlled Select in VenueAdminPanel"

# Test 5: Delete Registration Error
grep -q "setRegError" frontend/app/admin/horses/\[id\]/EditHorseForm.tsx
test_result "Delete Registration Error Handling"

# Test 6: Design Tokens
grep -q "\-\-border-subtle:" frontend/app/globals.css
test_result "CSS Variable: --border-subtle"

grep -q "\-\-bg-subtle:" frontend/app/globals.css
test_result "CSS Variable: --bg-subtle"

grep -q "\-\-text-deep:" frontend/app/globals.css
test_result "CSS Variable: --text-deep"

grep -q "@theme {" frontend/app/globals.css
test_result "Tailwind @theme Configuration"

# Test 7: Error Boundaries & Loading
[ -f "frontend/app/admin/error.tsx" ]
test_result "Error Boundary: admin/"

[ -f "frontend/app/admin/shows/\[id\]/error.tsx" ]
test_result "Error Boundary: admin/shows/[id]/"

[ -f "frontend/app/admin/horses/\[id\]/error.tsx" ]
test_result "Error Boundary: admin/horses/[id]/"

[ -f "frontend/app/admin/loading.tsx" ]
test_result "Loading State: admin/"

[ -f "frontend/app/dashboard/loading.tsx" ]
test_result "Loading State: dashboard/"

[ -f "frontend/app/profile/loading.tsx" ]
test_result "Loading State: profile/"

# Test 8: Backend Dependencies
grep -q "fastapi==0.115" backend/requirements.txt
test_result "Backend: FastAPI updated to 0.115.12+"

grep -q "cryptography==44" backend/requirements.txt
test_result "Backend: Cryptography updated to 44.0.2+"

grep -q "python-multipart==0.0.20" backend/requirements.txt
test_result "Backend: python-multipart updated to 0.0.20+"

! grep -q "python-jose" backend/requirements.txt
test_result "Backend: python-jose removed"

! grep -q "passlib" backend/requirements.txt
test_result "Backend: passlib removed"

# Test 9: Frontend Dependencies
grep -q '"next-auth": "^5.0.0"' frontend/package.json
test_result "Frontend: next-auth upgraded to stable v5"

grep -q '"@testing-library/react": "^16' frontend/package.json
test_result "Frontend: @testing-library/react upgraded to v16"

grep -q '"eslint": "^9' frontend/package.json
test_result "Frontend: ESLint upgraded to v9"

# Test 10: Legacy Columns Dropped
! grep -q "venue TEXT" database/schema.sql
test_result "Database: shows.venue TEXT column removed"

! grep -q "owner_name TEXT" database/schema.sql
test_result "Database: horses.owner_name TEXT column removed"

# Test 11: Migrations
[ -f "database/migrations/017_drop_legacy_venue_column.sql" ]
test_result "Migration 017: Venue column drop"

[ -f "database/migrations/018_drop_legacy_owner_name_column.sql" ]
test_result "Migration 018: Owner name column drop"

# Test 12: Backend Venue Changes
grep -q "venue_rel.name" backend/routers/shows.py
test_result "Backend: shows.py uses venue_rel.name"

grep -q "venue_rel.name" backend/routers/dashboard.py
test_result "Backend: dashboard.py uses venue_rel.name"

# Test 13: Show Model
! grep -q "venue = Column" backend/models.py
test_result "Backend: Show model venue Column removed"

grep -q "venue_id = Column" backend/models.py
test_result "Backend: Show model venue_id FK present"

# Test 14: APHA Constants
[ -f "frontend/lib/apha.ts" ]
test_result "Frontend: APHA constants extracted to lib/apha.ts"

grep -q "export const APHA_DIVISIONS" frontend/lib/apha.ts
test_result "Frontend: APHA_DIVISIONS exported"

# ============================================================
# RESULTS SUMMARY
# ============================================================
echo -e "\n${BLUE}=== Test Summary ===${NC}\n"
echo "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Failed: $FAILED${NC}"
fi

echo "" >> "$RESULTS_FILE"
echo "## Summary" >> "$RESULTS_FILE"
echo "- **Total Tests**: $TOTAL" >> "$RESULTS_FILE"
echo "- **Passed**: $PASSED ✅" >> "$RESULTS_FILE"
echo "- **Failed**: $FAILED" >> "$RESULTS_FILE"

if [ $FAILED -eq 0 ]; then
  echo -e "\n${GREEN}✅ All tests passed!${NC}"
  echo "" >> "$RESULTS_FILE"
  echo "**Status**: ✅ ALL TESTS PASSED" >> "$RESULTS_FILE"
  exit 0
else
  echo -e "\n${RED}❌ Some tests failed${NC}"
  echo "" >> "$RESULTS_FILE"
  echo "**Status**: ❌ SOME TESTS FAILED" >> "$RESULTS_FILE"
  exit 1
fi
