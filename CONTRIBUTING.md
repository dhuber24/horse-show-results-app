# Contributing to Horse Show Results App

Thank you for contributing! This document provides guidelines for working on this project.

## Table of Contents
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/dhuber24/horse-show-results-app.git
   cd horse-show-results-app
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

3. **Start development environment**
   ```bash
   docker-compose up
   ```

   Or for local development without Docker, see [DEVELOPMENT.md](./DEVELOPMENT.md)

## Development Workflow

### Creating a Feature Branch

```bash
# Update main branch
git checkout main
git pull origin main

# Create feature branch with descriptive name
git checkout -b feature/add-user-authentication
# or
git checkout -b fix/correct-placing-validation
```

**Branch naming convention:**
- `feature/description` — New feature
- `fix/description` — Bug fix
- `docs/description` — Documentation
- `refactor/description` — Code refactoring
- `test/description` — Tests
- `chore/description` — Maintenance

### Before You Start Coding

1. Check [Issues](https://github.com/dhuber24/horse-show-results-app/issues) for existing work
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand system design
3. Check if your change aligns with the [Roadmap](#roadmap) (if available)

## Code Style

### Python (Backend)

**Standards:**
- Follow [PEP 8](https://www.python.org/dev/peps/pep-0008/)
- Use type hints for all functions
- Max line length: 100 characters
- 4-space indentation

**Tools:**
```bash
# Format code
black backend/

# Check style
flake8 backend/

# Sort imports
isort backend/

# Type checking
mypy backend/
```

**Example:**
```python
from typing import Optional
from fastapi import APIRouter, Depends
from database import get_db

router = APIRouter(prefix="/shows", tags=["shows"])

async def get_show_by_id(
    show_id: str, 
    db: Session = Depends(get_db)
) -> dict:
    """
    Retrieve a show by ID.
    
    Args:
        show_id: The UUID of the show
        db: Database session
        
    Returns:
        Show data dictionary
        
    Raises:
        HTTPException: If show not found
    """
    show = db.query(Show).filter(Show.id == show_id).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")
    return show
```

### TypeScript/JavaScript (Frontend)

**Standards:**
- Use TypeScript for type safety
- Follow [ESLint](https://eslint.org/) configuration
- Functional components only (no class components)
- Max line length: 100 characters
- Use meaningful variable names

**Tools:**
```bash
# Format code
npm run format

# Lint code
npm run lint

# Type check
npm run type-check
```

**Example:**
```typescript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface Show {
  id: string;
  name: string;
  date: string;
  location: string;
}

export const ShowList: React.FC = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchShows = async () => {
      try {
        const response = await axios.get('/api/shows');
        setShows(response.data);
      } catch (err) {
        setError('Failed to load shows');
      } finally {
        setLoading(false);
      }
    };

    fetchShows();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {shows.map((show) => (
        <div key={show.id}>
          <h2>{show.name}</h2>
          <p>{show.date} - {show.location}</p>
        </div>
      ))}
    </div>
  );
};
```

## Testing

### Python Tests (Backend)

**Requirements:**
- Write tests for new functions
- Aim for 80%+ coverage
- Use pytest + pytest-asyncio for async tests

**Running tests:**
```bash
cd backend
pytest                          # Run all tests
pytest -v                       # Verbose output
pytest --cov                    # With coverage report
pytest -k test_auth             # Run specific test
```

**Example test:**
```python
import pytest
from fastapi.testclient import TestClient
from main import app
from database import Session

client = TestClient(app)

@pytest.fixture
def test_db():
    # Setup test database
    db = Session()
    yield db
    db.close()

def test_create_show(test_db):
    """Test creating a new show."""
    response = client.post(
        "/shows",
        json={
            "name": "Spring Show 2024",
            "date": "2024-05-15",
            "location": "Austin, TX",
            "association": "AQHA"
        },
        headers={"Authorization": "Bearer valid-token"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Spring Show 2024"
```

### TypeScript Tests (Frontend)

**Requirements:**
- Write tests for components and utilities
- Use Jest + React Testing Library
- Aim for 80%+ coverage

**Running tests:**
```bash
cd frontend
npm test                        # Run all tests
npm test -- --coverage          # With coverage report
npm test -- --watch             # Watch mode
```

**Example test:**
```typescript
import { render, screen } from '@testing-library/react';
import { ShowList } from './ShowList';

describe('ShowList', () => {
  it('displays loading state initially', () => {
    render(<ShowList />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('displays shows after loading', async () => {
    render(<ShowList />);
    // Mock API response
    // Wait for content to load
    // Assert shows are displayed
  });
});
```

## Commit Messages

**Format:**
```
<type>(<scope>): <subject>

<body>

Fixes #<issue-number>
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `style` — Formatting (no code change)
- `refactor` — Code refactoring
- `test` — Adding/updating tests
- `chore` — Maintenance (dependencies, etc.)

**Examples:**
```
feat(auth): add JWT token refresh endpoint

Implement token refresh mechanism with 30-day expiration.
Add refresh_token table to track valid refresh tokens.

Fixes #42

---

fix(placings): prevent duplicate placements in same class

Added unique constraint on (entry_id, class_id) to database.
Update API validation to catch duplicates before database.

Fixes #38

---

docs(readme): update installation instructions

Clarify Docker Compose setup for Windows users.

---

test(shows): add unit tests for show creation

Add test coverage for show creation endpoint.
Tests cover validation, authorization, and database persistence.
```

**Guidelines:**
- Use imperative mood ("add" not "added" or "adds")
- Don't capitalize subject line
- No period at end of subject
- Limit subject to 50 characters
- Wrap body at 72 characters
- Reference related issues

## Pull Request Process

### Before Creating a PR

1. **Update your branch with main**
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run all tests**
   ```bash
   # Backend
   cd backend && pytest --cov
   
   # Frontend
   cd frontend && npm test
   ```

3. **Run linters**
   ```bash
   # Backend
   cd backend && black . && flake8 . && mypy .
   
   # Frontend
   cd frontend && npm run lint
   ```

4. **Ensure your code builds**
   ```bash
   # Backend should start without errors
   uvicorn main:app --reload
   
   # Frontend should build
   npm run build
   ```

### Creating the PR

1. Push your branch to GitHub
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request with:
   - Clear title describing the change
   - Description of what changed and why
   - Link to related issue(s): `Fixes #123`
   - Test coverage information
   - Any breaking changes documented

3. PR Title Format:
   ```
   [Type] Brief description (e.g., [FEAT] Add user authentication)
   ```

### PR Checklist

- [ ] Code follows style guidelines
- [ ] All tests pass locally
- [ ] New code has tests
- [ ] Documentation is updated
- [ ] No debug code or console.logs
- [ ] Commit messages are clear
- [ ] No hardcoded secrets or credentials

### Review Process

- At least one approval required before merge
- Automated tests must pass
- Code style checks must pass
- All conversations resolved

## Questions?

- Check existing [Issues](https://github.com/dhuber24/horse-show-results-app/issues)
- Open a new [Issue](https://github.com/dhuber24/horse-show-results-app/issues/new) for questions
- Check [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions

---

Thank you for contributing to Horse Show Results App! 🎉
