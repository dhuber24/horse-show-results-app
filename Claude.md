# Claude.md - Horse Show Results App

## Project Overview

**Horse Show Results App** is a browser-based application designed for managing ranch and western pleasure horse shows. It provides a streamlined workflow for show entry management, number assignment, result scoring, and live publishing.

**Key Differentiator:** This is a manual placement entry system—it does NOT include judging, maneuver scoring, penalties, or rule enforcement. Placings are entered by show office staff and published as-is.

## Project Scope

### What This App Does
- Exhibitors sign up for classes
- Show office assigns back numbers to exhibitors
- Official scorekeepers manually enter placings
- Results are published live to participants

### What This App Does NOT Do
- No automated judging
- No maneuver or performance scoring
- No penalty calculations
- No rule enforcement or validation logic

## Supported Associations
- AQHA (American Quarter Horse Association)
- APHA (American Paint Horse Association)
- WSCA (Western States Cutting Association)
- NSBA (National Snaffle Bit Association)

## User Roles
- **Admin:** Show setup, configuration, and management
- **Scorekeeper:** Entry of placings and results
- **Exhibitor:** Viewing personal entries and results

## Technology Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Frontend** | Next.js (PWA) | Progressive Web App for cross-platform access |
| **Backend** | FastAPI | Modern Python async API framework |
| **Database** | PostgreSQL | Relational database for persistent storage |
| **Deployment** | Docker + GitHub Codespaces | Containerized application with cloud-based dev environment |
| **Version Control** | Git | GitHub-hosted repository |

## Project Structure

```
horse-show-results-app/
├── backend/              # FastAPI application
├── frontend/             # Next.js PWA application
├── database/             # PostgreSQL schema and migrations
├── docker-compose.yml    # Local development orchestration
└── README.md             # Project overview
```

### Backend (`/backend`)
- **Framework:** FastAPI
- **Language:** Python
- **Purpose:** REST API serving the frontend application
- **Key Responsibilities:**
  - User authentication and authorization
  - Show, class, and entry management
  - Placing entry and result calculation
  - Real-time result publishing
  - Data validation and business logic

### Frontend (`/frontend`)
- **Framework:** Next.js
- **Type:** Progressive Web App (PWA)
- **Language:** JavaScript/TypeScript
- **Purpose:** User interface for all roles (admin, scorekeeper, exhibitor)
- **Key Features:**
  - Offline capability (PWA)
  - Cross-device responsiveness
  - Real-time result updates
  - Role-based access control

### Database (`/database`)
- **System:** PostgreSQL
- **Purpose:** Persistent storage for shows, exhibitors, entries, and results
- **Expected Entities:**
  - Shows (events)
  - Exhibitors/Riders
  - Classes (competition categories)
  - Entries (exhibitor + class registrations)
  - Placings (results with order)
  - Users (with roles)
  - Associations (AQHA, APHA, WSCA, NSBA)

## Development Environment

### Local Development Setup
```bash
# Prerequisites: Docker, Docker Compose

# Start all services
docker-compose up

# Services will be available at:
# - Frontend: http://localhost:3000 (or configured port)
# - Backend API: http://localhost:8000 (or configured port)
# - PostgreSQL: localhost:5432 (or configured port)
```

### Key Configuration Files
- `docker-compose.yml` — Defines services for local development (backend, frontend, database)

## Current Status
🚧 **Initial Setup** — Project is in early development phase with core infrastructure being established.

## Development Guidelines for Claude

### When Working on This Project

1. **API Design**: Follow RESTful conventions. Backend provides JSON API; frontend consumes it.

2. **Database Queries**: Write migrations in `/database` folder. Keep schema organized and well-documented.

3. **Frontend Components**: Use Next.js best practices. Consider PWA capabilities for offline access.

4. **Authentication**: Plan for role-based access control (Admin, Scorekeeper, Exhibitor roles).

5. **Data Validation**: Implement validation at both API and database layers.

6. **Testing**: Include unit tests and integration tests as features are added.

7. **Environment Variables**: Keep sensitive config in environment, not hardcoded.

### Code Style & Best Practices
- **Python (Backend):** Follow PEP 8. Use type hints.
- **JavaScript/TypeScript (Frontend):** Use modern ES6+ syntax. Configure linting if not present.
- **Git Commits:** Write clear, descriptive commit messages.

## Key Concepts

### Placings vs. Results
- **Placings:** The order in which exhibitors finished (1st, 2nd, 3rd, etc.)
- **Results:** The published, finalized placings shown to exhibitors

### Show Workflow
1. Admin creates a new show event
2. Exhibitors register and enter classes
3. Admin/office staff assigns back numbers
4. Scorekeepers enter placings after each class
5. Results are immediately published (no review/approval process)

### Association Classes
Different horse show associations (AQHA, APHA, WSCA, NSBA) may have different class structures and naming conventions. The app should support flexible class definitions per association.

## Future Considerations

- Real-time notifications to exhibitors
- Export results to various formats (PDF, Excel)
- Integration with association websites
- Mobile-optimized scorekeeping interface
- Undo/correction workflows for entered placings
- Multi-arena/multi-ring support for larger shows

## Common Tasks & Commands

### Running the Application
```bash
docker-compose up
```

### Accessing Logs
```bash
docker-compose logs -f [service-name]
# service-name: backend, frontend, or db
```

### Database Migrations
```bash
# Instructions will be added once migration system is configured
```

### Testing
```bash
# Testing configuration to be established
```

## Contact & Questions
Refer to the main GitHub repository for issues, discussions, and collaboration:
https://github.com/dhuber24/horse-show-results-app

---

**Last Updated:** April 2026  
**Project Status:** 🚧 Initial Development

