# Architecture Overview - Horse Show Results App

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    End Users                                  │
│    (Admin, Scorekeeper, Exhibitor)                           │
└─────────────────────────┬──────────────────────────────────┘
                          │
                    HTTPS/WebSocket
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│            Frontend (Next.js PWA)                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ • Admin Dashboard (Show Setup)                         │  │
│  │ • Scorekeeper Interface (Enter Placings)              │  │
│  │ • Exhibitor View (Browse Results)                     │  │
│  │ • Authentication UI                                    │  │
│  │ • Real-time Result Updates (WebSocket)                │  │
│  │ • Offline Support (PWA - Service Workers)             │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │
                          │ HTTP REST API
                          │ + WebSocket
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              Backend API (FastAPI)                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Authentication Layer                                    │  │
│  │ • JWT Token Generation                                │  │
│  │ • Role-Based Access Control (RBAC)                    │  │
│  │ • User Sessions                                        │  │
│  │                                                        │  │
│  │ Resource Endpoints                                     │  │
│  │ • /shows - Show CRUD & Management                     │  │
│  │ • /classes - Class Definitions (per association)      │  │
│  │ • /entries - Exhibitor Registrations                  │  │
│  │ • /placings - Result Entry & Publishing               │  │
│  │ • /users - User Management (Admin)                    │  │
│  │ • /exhibitors - Exhibitor Profiles                    │  │
│  │                                                        │  │
│  │ WebSocket Handlers                                     │  │
│  │ • Real-time placings broadcast                        │  │
│  │ • Live result updates                                 │  │
│  │                                                        │  │
│  │ Business Logic Layer                                   │  │
│  │ • Placing validation & conflict detection             │  │
│  │ • Result aggregation & publishing                     │  │
│  │ • Association-specific rules                          │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │
                          │ SQL Protocol
                          │ (SQLAlchemy ORM)
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              Database (PostgreSQL)                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Core Tables                                            │  │
│  │ ├── shows (event information)                         │  │
│  │ ├── exhibitors (rider/owner data)                     │  │
│  │ ├── classes (competition categories)                  │  │
│  │ ├── entries (show registrations)                      │  │
│  │ ├── placings (competition results)                    │  │
│  │ ├── users (system users)                              │  │
│  │ └── associations (AQHA, APHA, WSCA, NSBA)           │  │
│  │                                                        │  │
│  │ Supporting Tables                                      │  │
│  │ ├── back_numbers (exhibitor numbers per show)         │  │
│  │ ├── class_associations (class per association)        │  │
│  │ └── audit_logs (admin actions)                        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Frontend** | Next.js | 14.x | React framework with SSR, routing, PWA |
| **Frontend Runtime** | React | 18.x | UI component library |
| **Frontend State** | TBD | TBD | State management (Redux, Zustand, or Context) |
| **Backend** | FastAPI | 0.10+ | Async Python web framework |
| **Backend Runtime** | Python | 3.11+ | Programming language |
| **Database** | PostgreSQL | 14+ | Relational database |
| **ORM** | SQLAlchemy | 2.0+ | Python SQL toolkit & ORM |
| **Authentication** | JWT | N/A | Stateless token-based auth |
| **Container** | Docker | Latest | Containerization |
| **Orchestration** | Docker Compose | Latest | Local dev environment |

## Core Components

### 1. Frontend (Next.js PWA)

**Location:** `/frontend`

**Responsibilities:**
- Render user interfaces for three roles (Admin, Scorekeeper, Exhibitor)
- Handle user authentication (login/logout)
- Validate user input before API submission
- Display real-time results via WebSocket
- Cache data locally for offline access (PWA)
- Manage client-side routing and navigation

**Key Pages:**
- `/login` — Authentication
- `/admin/shows` — Show setup & management
- `/admin/users` — User management
- `/scorekeeper/classes/:showId` — Place entries for a class
- `/exhibitor/shows` — Browse available shows
- `/exhibitor/results/:showId` — View results
- `/exhibitor/entries/:showId` — View own entries

**Technology Details:**
- **Routing:** Next.js file-based routing
- **Styling:** TBD (Tailwind, CSS Modules, Styled Components)
- **State Management:** TBD
- **API Client:** Fetch API or Axios
- **Real-time:** WebSocket client library
- **PWA:** next-pwa package

### 2. Backend (FastAPI)

**Location:** `/backend`

**Responsibilities:**
- Authenticate users and issue JWT tokens
- Enforce role-based access control on all endpoints
- Validate incoming data against Pydantic models
- Process business logic (placings, conflict detection, result publishing)
- Persist data to PostgreSQL via SQLAlchemy
- Broadcast real-time updates via WebSocket
- Log all admin actions for audit trail

**Directory Structure:**
```
backend/
├── main.py                 # FastAPI app initialization
├── requirements.txt        # Python dependencies
├── config.py              # Configuration (env vars, constants)
├── database.py            # Database connection & session
├── auth/
│   ├── __init__.py
│   ├── models.py          # User model
│   ├── schemas.py         # Pydantic schemas
│   ├── crud.py            # Create/Read/Update/Delete functions
│   └── routes.py          # /auth endpoints
├── shows/
│   ├── models.py          # Show, Class models
│   ├── schemas.py         # Show/Class Pydantic schemas
│   ├── crud.py            # Show CRUD operations
│   └── routes.py          # /shows endpoints
├── entries/
│   ├── models.py          # Entry model
│   ├── schemas.py         # Entry schemas
│   ├── crud.py            # Entry operations
│   └── routes.py          # /entries endpoints
├── placings/
│   ├── models.py          # Placing model
│   ├── schemas.py         # Placing schemas
│   ├── crud.py            # Placing operations
│   ├── routes.py          # /placings endpoints
│   └── business_logic.py  # Validation, conflict detection
├── exhibitors/
│   ├── models.py          # Exhibitor model
│   ├── schemas.py         # Exhibitor schemas
│   ├── crud.py
│   └── routes.py
├── websocket/
│   ├── __init__.py
│   ├── manager.py         # WebSocket connection manager
│   └── routes.py          # WebSocket endpoints
├── middleware/
│   ├── __init__.py
│   ├── auth.py            # Authentication middleware
│   └── error_handler.py    # Error handling
└── tests/
    ├── conftest.py        # Pytest configuration
    ├── test_auth.py
    ├── test_shows.py
    └── [more tests...]
```

**API Endpoints (by category):**

**Authentication:**
```
POST   /auth/login              → Get JWT token
POST   /auth/logout             → Invalidate token
POST   /auth/refresh            → Get new token
POST   /auth/register           → Create new user (Admin only)
```

**Shows:**
```
GET    /shows                   → List all shows
POST   /shows                   → Create show (Admin)
GET    /shows/{show_id}         → Get show details
PUT    /shows/{show_id}         → Update show (Admin)
DELETE /shows/{show_id}         → Delete show (Admin)
GET    /shows/{show_id}/status  → Get show status
```

**Classes:**
```
GET    /shows/{show_id}/classes → List classes for show
POST   /shows/{show_id}/classes → Add class to show (Admin)
```

**Entries:**
```
POST   /shows/{show_id}/entries           → Submit entry
GET    /shows/{show_id}/entries           → List entries (role-dependent)
GET    /shows/{show_id}/entries/{entry_id} → Get entry details
DELETE /shows/{show_id}/entries/{entry_id} → Withdraw entry
```

**Placings (Results):**
```
POST   /shows/{show_id}/classes/{class_id}/placings → Enter placings (Scorekeeper)
GET    /shows/{show_id}/results                      → Get published results
PUT    /placings/{placing_id}                        → Update placing (Scorekeeper, within time limit)
DELETE /placings/{placing_id}                        → Delete placing (Scorekeeper, within time limit)
```

**Exhibitors:**
```
GET    /exhibitors              → List all exhibitors
POST   /exhibitors              → Create exhibitor profile
GET    /exhibitors/{exhibitor_id} → Get exhibitor details
PUT    /exhibitors/{exhibitor_id} → Update exhibitor
```

**Users (Admin):**
```
GET    /users                   → List all users (Admin)
POST   /users                   → Create new user (Admin)
PUT    /users/{user_id}         → Update user (Admin)
DELETE /users/{user_id}         → Delete user (Admin)
```

**WebSocket:**
```
WS     /ws/{show_id}            → Real-time placings updates
```

### 3. Database (PostgreSQL)

**Location:** `/database`

**Core Tables:**

**shows**
- `id` (UUID, Primary Key)
- `name` (VARCHAR, Required)
- `date` (DATE, Required)
- `location` (VARCHAR)
- `association` (ENUM: AQHA, APHA, WSCA, NSBA)
- `status` (ENUM: planning, entries_open, in_progress, completed)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)
- `created_by` (FK → users)

**classes**
- `id` (UUID, Primary Key)
- `name` (VARCHAR, Required)
- `association` (ENUM: AQHA, APHA, WSCA, NSBA)
- `level` (VARCHAR) — e.g., "Novice", "Amateur", "Open"
- `gender_restriction` (VARCHAR) — e.g., "Any", "Mares Only"
- `description` (TEXT)

**exhibitors**
- `id` (UUID, Primary Key)
- `first_name` (VARCHAR, Required)
- `last_name` (VARCHAR, Required)
- `email` (VARCHAR, Unique)
- `phone` (VARCHAR)
- `association_number` (VARCHAR) — AQHA number, APHA number, etc.
- `created_at` (TIMESTAMP)

**entries**
- `id` (UUID, Primary Key)
- `show_id` (FK → shows, Required)
- `exhibitor_id` (FK → exhibitors, Required)
- `class_id` (FK → classes, Required)
- `back_number` (INTEGER)
- `status` (ENUM: registered, withdrawn, disqualified)
- `created_at` (TIMESTAMP)
- `Unique constraint: (show_id, exhibitor_id, class_id)`

**placings**
- `id` (UUID, Primary Key)
- `entry_id` (FK → entries, Required)
- `class_id` (FK → classes, Required)
- `placing` (INTEGER) — 1 for 1st place, 2 for 2nd, etc.
- `notes` (TEXT) — e.g., "No time", "Fall", "Refusal"
- `entered_by` (FK → users, Required)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)
- `Unique constraint: (entry_id) — only one placing per entry per class`

**users**
- `id` (UUID, Primary Key)
- `username` (VARCHAR, Unique, Required)
- `email` (VARCHAR, Unique, Required)
- `hashed_password` (VARCHAR, Required)
- `role` (ENUM: admin, scorekeeper, exhibitor, Required)
- `is_active` (BOOLEAN, Default: True)
- `created_at` (TIMESTAMP)

**Relationships:**
```
shows ──1──∞── entries
       ──1──∞── classes
       ──1──∞── placings (via entry)

exhibitors ──1──∞── entries

classes ──1──∞── entries
        ──1──∞── placings

entries ──1──∞── placings

users ──1──∞── shows (created_by)
      ──1──∞── placings (entered_by)
```

## Data Flow

### Happy Path: Entering a Placing (Result)

```
1. Scorekeeper logs in
   → Frontend sends credentials to /auth/login
   → Backend validates, returns JWT token
   → Frontend stores token in localStorage/memory

2. Scorekeeper selects show & class
   → Frontend requests /shows/{show_id}/classes/{class_id}
   → Backend returns class details + list of entries

3. Scorekeeper enters placings for each entry
   → Frontend shows form with entry details
   → Scorekeeper assigns placing numbers (1st, 2nd, 3rd, etc.)

4. Scorekeeper submits placings
   → Frontend sends POST /shows/{show_id}/classes/{class_id}/placings
   → Backend validates:
     ├── User is authenticated as scorekeeper
     ├── No duplicate placings
     ├── All entries for class have placings
     └── Placing numbers are sequential (1, 2, 3, ...)
   → Backend saves to database
   → Backend broadcasts update via WebSocket

5. Results are published
   → Backend sends updates to connected WebSocket clients
   → All exhibitor browsers receive real-time updates
   → Exhibitor app shows updated results (no page refresh needed)
```

### User Role & Permissions

**Admin**
- Create shows, manage associations
- Create user accounts
- Manage scorekeepers
- View all results
- View all entries
- Cannot enter placings

**Scorekeeper**
- View assigned shows
- View entries for show
- Enter placings for classes
- Cannot delete placings (unless within configurable time window)
- Cannot create shows or manage users

**Exhibitor**
- View available shows
- Submit entries
- View own entries
- View results (published)
- Cannot view other exhibitors' entries
- Cannot enter placings

## Error Handling Strategy

**API Errors:**
- 400 Bad Request — Invalid input data
- 401 Unauthorized — Missing or invalid token
- 403 Forbidden — User role lacks permission
- 404 Not Found — Resource doesn't exist
- 409 Conflict — Placing duplicate/conflict detected
- 500 Internal Server Error — Server error (log details)

**Business Logic Errors:**
- Invalid placing sequence (gaps in numbering)
- Duplicate placing for same entry
- Scorekeeper entering placings after deadline
- Exhibitor entering class with conflicting back number

**Client Handling:**
- Display user-friendly error messages
- Log detailed errors server-side
- Provide recovery options where possible

## Security Considerations

**Authentication:**
- JWT tokens expire after 24 hours
- Refresh tokens valid for 30 days
- Passwords hashed with bcrypt
- No plain-text passwords stored

**Authorization:**
- Every endpoint validates user role
- Exhibitors can only see their own data
- Scorekeepers can only enter placings for assigned shows
- Admins have full access

**Data Protection:**
- Sensitive data (passwords, tokens) never logged
- API communications via HTTPS (enforced)
- Database credentials in environment variables
- Audit log of all admin actions

**Input Validation:**
- All inputs validated against Pydantic models
- SQL injection prevention via SQLAlchemy ORM
- CSRF protection via same-site cookies
- Rate limiting on auth endpoints (future)

## Deployment Architecture

**Development:**
- Docker Compose locally
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Database: localhost:5432

**Production:**
- GitHub Codespaces or cloud provider
- Containerized services
- Separate database server
- Reverse proxy (Nginx)
- HTTPS with Let's Encrypt
- Environment-based configuration

## Performance Considerations

**Frontend:**
- PWA caching for offline support
- Lazy loading for large result lists
- WebSocket for real-time updates (no polling)
- Pagination for exhibitor lists

**Backend:**
- Database indexes on frequently-queried columns:
  - `entries.show_id`
  - `placings.class_id`
  - `users.username`
- Connection pooling for database
- Async handlers for I/O operations
- Batch operations where possible

**Database:**
- Indexes on foreign keys
- Partitioning (future) for large show archives
- Regular backups

## Future Extensions

- **Real-time Notifications:** Notify exhibitors when results posted
- **PDF Export:** Generate result sheets and award documents
- **Multi-Arena Support:** Multiple rings running simultaneously
- **Photo Integration:** Attach photos to results
- **Mobile App:** Native iOS/Android
- **Advanced Reports:** Analytics, statistics, trends
- **Integration:** Sync with association websites

