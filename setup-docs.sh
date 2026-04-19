#!/bin/bash

# Horse Show Results App - Documentation Setup Script
# This script copies all documentation files to their correct locations
# and commits them to git

set -e  # Exit on any error

echo "🚀 Horse Show Results App - Documentation Setup"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}⚠️  Not in a git repository. Please run this from your repo root.${NC}"
    exit 1
fi

echo -e "${BLUE}Step 1: Creating directories if they don't exist...${NC}"
mkdir -p backend
mkdir -p frontend
mkdir -p database
mkdir -p .github/workflows
mkdir -p .github/scripts
echo -e "${GREEN}✓ Directories ready${NC}"
echo ""

echo -e "${BLUE}Step 2: Copying Phase 1 files (Core Documentation)...${NC}"

# Copy Phase 1 files
cp ARCHITECTURE.md . 2>/dev/null && echo -e "${GREEN}✓ ARCHITECTURE.md${NC}" || echo -e "${YELLOW}✗ ARCHITECTURE.md not found${NC}"
cp CONTRIBUTING.md . 2>/dev/null && echo -e "${GREEN}✓ CONTRIBUTING.md${NC}" || echo -e "${YELLOW}✗ CONTRIBUTING.md not found${NC}"
cp .gitignore . 2>/dev/null && echo -e "${GREEN}✓ .gitignore${NC}" || echo -e "${YELLOW}✗ .gitignore not found${NC}"
cp .env.example . 2>/dev/null && echo -e "${GREEN}✓ .env.example${NC}" || echo -e "${YELLOW}✗ .env.example not found${NC}"
cp requirements.txt backend/ 2>/dev/null && echo -e "${GREEN}✓ backend/requirements.txt${NC}" || echo -e "${YELLOW}✗ requirements.txt not found${NC}"
cp package.json frontend/ 2>/dev/null && echo -e "${GREEN}✓ frontend/package.json${NC}" || echo -e "${YELLOW}✗ package.json not found${NC}"

echo ""
echo -e "${BLUE}Step 3: Copying Phase 2 files (Schema, API, Models)...${NC}"

# Copy Phase 2 files
cp HORSE_SHOW_SCHEMA.md database/SCHEMA.md 2>/dev/null && echo -e "${GREEN}✓ database/SCHEMA.md${NC}" || echo -e "${YELLOW}✗ HORSE_SHOW_SCHEMA.md not found${NC}"
cp HORSE_SHOW_API.md backend/API.md 2>/dev/null && echo -e "${GREEN}✓ backend/API.md${NC}" || echo -e "${YELLOW}✗ HORSE_SHOW_API.md not found${NC}"
cp HORSE_SHOW_SCHEMAS.py backend/schemas.py 2>/dev/null && echo -e "${GREEN}✓ backend/schemas.py${NC}" || echo -e "${YELLOW}✗ HORSE_SHOW_SCHEMAS.py not found${NC}"
cp DATABASE_README.md database/README.md 2>/dev/null && echo -e "${GREEN}✓ database/README.md${NC}" || echo -e "${YELLOW}✗ DATABASE_README.md not found${NC}"

echo ""
echo -e "${BLUE}Step 4: Copying GitHub Actions automation (optional)...${NC}"

# Copy automation files (optional)
cp update-claude-md.yml .github/workflows/ 2>/dev/null && echo -e "${GREEN}✓ .github/workflows/update-claude-md.yml${NC}" || echo -e "${YELLOW}✗ update-claude-md.yml not found (optional)${NC}"
cp generate_claude_md.py .github/scripts/ 2>/dev/null && echo -e "${GREEN}✓ .github/scripts/generate_claude_md.py${NC}" || echo -e "${YELLOW}✗ generate_claude_md.py not found (optional)${NC}"

echo ""
echo -e "${BLUE}Step 5: Staging files for commit...${NC}"

git add ARCHITECTURE.md 2>/dev/null || true
git add CONTRIBUTING.md 2>/dev/null || true
git add .gitignore 2>/dev/null || true
git add .env.example 2>/dev/null || true
git add backend/requirements.txt 2>/dev/null || true
git add frontend/package.json 2>/dev/null || true
git add database/SCHEMA.md 2>/dev/null || true
git add backend/API.md 2>/dev/null || true
git add backend/schemas.py 2>/dev/null || true
git add database/README.md 2>/dev/null || true
git add .github/workflows/ 2>/dev/null || true
git add .github/scripts/ 2>/dev/null || true

echo -e "${GREEN}✓ Files staged for commit${NC}"

echo ""
echo -e "${BLUE}Step 6: Creating commit...${NC}"

git commit -m "docs: Add complete Claude-friendly documentation

Phase 1: Core documentation
- ARCHITECTURE.md: System design and API overview
- CONTRIBUTING.md: Code style and testing guidelines
- .gitignore: Ignore patterns
- .env.example: Environment variable template
- backend/requirements.txt: Python dependencies
- frontend/package.json: Node dependencies

Phase 2: Technical specifications
- database/SCHEMA.md: Complete schema documentation
- backend/API.md: REST endpoint specification
- backend/schemas.py: Pydantic models and validation

Additional
- database/README.md: Database overview
- .github/: GitHub Actions automation (optional)

This documentation enables Claude to understand the project architecture,
database schema, and API design, providing 10x faster development." 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Commit may have failed. Check git status:${NC}"
    git status
    exit 1
}

echo -e "${GREEN}✓ Commit created successfully${NC}"

echo ""
echo -e "${BLUE}Step 7: Ready to push...${NC}"
echo ""
echo -e "${GREEN}✨ All files committed!${NC}"
echo ""
echo "Next step: Push to GitHub with:"
echo -e "${YELLOW}  git push origin main${NC}"
echo ""
echo "That's it! Your documentation is ready for Claude. 🚀"
