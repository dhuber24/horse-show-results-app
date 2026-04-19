# Database Schema - Horse Show Results App

## Overview

This document describes the complete PostgreSQL database schema for the Horse Show Results App. The schema supports multi-ring, multi-division horse shows with manual result entry and audit trail tracking.

**Database:** PostgreSQL 14+  
**ORM:** SQLAlchemy 2.0+  
**Migrations:** Alembic  

---

## Entity Relationship Diagram

```
┌─────────────┐
│   venues    │
└──────┬──────┘
       │
       ▼
┌─────────────────┐         ┌──────────┐
│     shows       │◄────────│  users   │
└────┬────────────┘         └──────────┘
     │
     ├─────────────┬──────────────┐
     │             │              │
     ▼             ▼              ▼
┌─────────┐  ┌──────────┐  ┌───────────┐
│  rings  │  │divisions │  │ classes   │
└─────────┘  └──────────┘  └─────┬─────┘
                                  │
                    ┌─────────────┤
                    │             │
                    ▼             ▼
            ┌──────────────┐  ┌─────────┐
            │   entries    │  │ results │
            └──────┬───────┘  └────┬────┘
                   │               │
         ┌─────────┼─────────┐     │
         │         │         │     │
         ▼         ▼         ▼     ▼
    ┌──────────┐┌─────────┐┌──────────────┐
    │exhibitors││horses   ││result_audit  │
    └─────┬────┘└────┬────┘└──────────────┘
          │          │
          └────┬─────┘
               ▼
    ┌─────────────────────┐
    │ exhibitor_horses    │
    └─────────────────────┘

┌─────────────┐
│show_entries │ (alternative entry tracking per show)
└─────────────┘
```

---

## Core Tables

### 1. **venues**
Physical locations where horse shows are held.

```sql
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| name | TEXT | NOT NULL | Venue name |
| address | TEXT | | Street address |
| city | TEXT | | City |
| state | TEXT | | State code |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Relationships:**
- One-to-Many: venues → shows (via shows.venue_id)

---

### 2. **shows**
Horse show events.

```sql
CREATE TABLE shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  venue TEXT,
  venue_id UUID REFERENCES venues(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| name | TEXT | NOT NULL | Show name |
| venue | TEXT | | Legacy venue field |
| venue_id | UUID | FK → venues | Venue reference |
| start_date | DATE | NOT NULL | Show start date |
| end_date | DATE | NOT NULL | Show end date |
| status | TEXT | DEFAULT 'DRAFT' | DRAFT, ACTIVE, COMPLETED |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes:**
```sql
CREATE INDEX idx_shows_venue_id ON shows(venue_id);
CREATE INDEX idx_shows_status ON shows(status);
CREATE INDEX idx_shows_start_date ON shows(start_date);
```

**Relationships:**
- Many-to-One: shows → venues (venue_id)
- One-to-Many: shows → rings
- One-to-Many: shows → divisions
- One-to-Many: shows → classes
- One-to-Many: shows → show_entries

**Notes:**
- `status` controls show lifecycle (DRAFT → ACTIVE → COMPLETED)
- Multi-day shows supported via start_date/end_date

---

### 3. **users**
System users with role-based access control.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  hashed_password TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| role | TEXT | NOT NULL | User role (ADMIN, SCOREKEEPER, EXHIBITOR) |
| full_name | TEXT | NOT NULL | Full name |
| email | TEXT | UNIQUE, NOT NULL | Email address |
| hashed_password | TEXT | | Bcrypt hashed password |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes:**
```sql
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

**Relationships:**
- One-to-Many: users → exhibitors (via exhibitors.user_id)
- One-to-Many: users → result_audit (via result_audit.changed_by)

---

### 4. **rings**
Performance areas/rings within a show.

```sql
CREATE TABLE rings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| show_id | UUID | FK → shows | Parent show |
| name | TEXT | NOT NULL | Ring name (e.g., "Ring A", "Indoor Ring") |

**Indexes:**
```sql
CREATE INDEX idx_rings_show_id ON rings(show_id);
```

**Relationships:**
- Many-to-One: rings → shows (show_id)
- One-to-Many: rings → classes

**Notes:**
- Multiple rings support simultaneous competitions
- Deleted with show (ON DELETE CASCADE)

---

### 5. **divisions**
Competition divisions within a show (e.g., Youth, Amateur, Open).

```sql
CREATE TABLE divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| show_id | UUID | FK → shows | Parent show |
| name | TEXT | NOT NULL | Division name (e.g., "Youth", "Amateur", "Open") |

**Indexes:**
```sql
CREATE INDEX idx_divisions_show_id ON divisions(show_id);
```

**Relationships:**
- Many-to-One: divisions → shows (show_id)
- One-to-Many: divisions → classes

**Notes:**
- Divisions organize competitors by skill level
- Deleted with show (ON DELETE CASCADE)

---

### 6. **classes**
Competition classes (specific events within a show).

```sql
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  ring_id UUID REFERENCES rings(id),
  division_id UUID REFERENCES divisions(id),
  class_number TEXT NOT NULL,
  class_name TEXT NOT NULL,
  class_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| show_id | UUID | FK → shows | Parent show |
| ring_id | UUID | FK → rings | Ring where class is held |
| division_id | UUID | FK → divisions | Division (optional) |
| class_number | TEXT | NOT NULL | Class number/code |
| class_name | TEXT | NOT NULL | Class name (e.g., "Western Pleasure") |
| class_date | DATE | NOT NULL | Date class is scheduled |
| status | TEXT | DEFAULT 'OPEN' | OPEN, IN_PROGRESS, COMPLETED |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes:**
```sql
CREATE INDEX idx_classes_show_id ON classes(show_id);
CREATE INDEX idx_classes_ring_id ON classes(ring_id);
CREATE INDEX idx_classes_division_id ON classes(division_id);
CREATE INDEX idx_classes_status ON classes(status);
CREATE INDEX idx_classes_class_date ON classes(class_date);
```

**Relationships:**
- Many-to-One: classes → shows (show_id)
- Many-to-One: classes → rings (ring_id, optional)
- Many-to-One: classes → divisions (division_id, optional)
- One-to-Many: classes → entries
- One-to-Many: classes → results

**Notes:**
- Ring and division are optional (nullable)
- Status tracks class progression
- class_number uniquely identifies within show

---

### 7. **horses**
Horse information.

```sql
CREATE TABLE horses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| name | TEXT | NOT NULL | Horse name |
| owner_name | TEXT | | Owner name |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Relationships:**
- One-to-Many: horses → exhibitor_horses
- One-to-Many: horses → entries

**Notes:**
- Represents individual horses competing
- Owner tracked separately from exhibitor

---

### 8. **exhibitors**
People who exhibit in shows.

```sql
CREATE TABLE exhibitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| full_name | TEXT | NOT NULL | Exhibitor's full name |
| user_id | UUID | FK → users | Associated user account |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Indexes:**
```sql
CREATE INDEX idx_exhibitors_user_id ON exhibitors(user_id);
```

**Relationships:**
- Many-to-One: exhibitors → users (user_id, optional)
- One-to-Many: exhibitors → entries
- One-to-Many: exhibitors → exhibitor_horses
- One-to-Many: exhibitors → show_entries

**Notes:**
- Can exist without user account
- user_id allows exhibitor login (optional)

---

### 9. **exhibitor_horses**
Junction table linking exhibitors to horses they exhibit.

```sql
CREATE TABLE exhibitor_horses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (exhibitor_id, horse_id)
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| exhibitor_id | UUID | FK → exhibitors | Exhibitor |
| horse_id | UUID | FK → horses | Horse |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Constraints:**
```sql
UNIQUE (exhibitor_id, horse_id)  -- Prevent duplicate relationships
```

**Indexes:**
```sql
CREATE INDEX idx_exhibitor_horses_exhibitor_id ON exhibitor_horses(exhibitor_id);
CREATE INDEX idx_exhibitor_horses_horse_id ON exhibitor_horses(horse_id);
```

**Relationships:**
- Many-to-One: exhibitor_horses → exhibitors
- Many-to-One: exhibitor_horses → horses

**Notes:**
- Tracks which horses each exhibitor can ride
- Unique constraint prevents duplicates

---

### 10. **show_entries**
Exhibitor registration for a show (back number assignment).

```sql
CREATE TABLE show_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  exhibitor_id UUID NOT NULL REFERENCES exhibitors(id),
  back_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (show_id, exhibitor_id),
  UNIQUE (show_id, back_number)
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| show_id | UUID | FK → shows | Which show |
| exhibitor_id | UUID | FK → exhibitors | Which exhibitor |
| back_number | INTEGER | | Assigned back number |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Constraints:**
```sql
UNIQUE (show_id, exhibitor_id)   -- One entry per exhibitor per show
UNIQUE (show_id, back_number)    -- Back numbers unique within show
```

**Indexes:**
```sql
CREATE INDEX idx_show_entries_show_id ON show_entries(show_id);
CREATE INDEX idx_show_entries_exhibitor_id ON show_entries(exhibitor_id);
CREATE INDEX idx_show_entries_back_number ON show_entries(back_number);
```

**Relationships:**
- Many-to-One: show_entries → shows
- Many-to-One: show_entries → exhibitors

**Notes:**
- Tracks show-level registration
- back_number is unique per show
- Separate from class entries (entries table)

---

### 11. **entries**
Entry of an exhibitor and horse combination into a specific class.

```sql
CREATE TABLE entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  exhibitor_id UUID NOT NULL REFERENCES exhibitors(id),
  horse_id UUID NOT NULL REFERENCES horses(id),
  back_number INTEGER,
  status TEXT NOT NULL DEFAULT 'ENTERED',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (class_id, exhibitor_id, horse_id)
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| class_id | UUID | FK → classes | Which class |
| exhibitor_id | UUID | FK → exhibitors | Which exhibitor |
| horse_id | UUID | FK → horses | Which horse |
| back_number | INTEGER | | Assigned back number for this class |
| status | TEXT | DEFAULT 'ENTERED' | ENTERED, WITHDRAWN, DISQUALIFIED |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Constraints:**
```sql
UNIQUE (class_id, exhibitor_id, horse_id)  -- Prevent duplicate entries
```

**Indexes:**
```sql
CREATE INDEX idx_entries_class_id ON entries(class_id);
CREATE INDEX idx_entries_exhibitor_id ON entries(exhibitor_id);
CREATE INDEX idx_entries_horse_id ON entries(horse_id);
CREATE INDEX idx_entries_status ON entries(status);
CREATE INDEX idx_entries_back_number ON entries(back_number);
```

**Relationships:**
- Many-to-One: entries → classes (class_id)
- Many-to-One: entries → exhibitors (exhibitor_id)
- Many-to-One: entries → horses (horse_id)
- One-to-Many: entries → results

**Notes:**
- Unique constraint prevents same exhibitor/horse in class twice
- back_number per class (may differ from show_entries back_number)
- Status tracks entry lifecycle

---

### 12. **results**
Competition results (placings) for entries in classes.

```sql
CREATE TABLE results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  place INTEGER NOT NULL CHECK (place > 0),
  is_tie BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (class_id, place, entry_id)
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| class_id | UUID | FK → classes | Which class |
| entry_id | UUID | FK → entries | Which entry |
| place | INTEGER | NOT NULL, CHECK > 0 | Placement (1st, 2nd, 3rd, etc.) |
| is_tie | BOOLEAN | DEFAULT false | Whether this is a tied placement |
| notes | TEXT | | Placing notes (e.g., "Withdrawn", "No Score") |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation timestamp |

**Constraints:**
```sql
CHECK (place > 0)                           -- Placement must be positive
UNIQUE (class_id, place, entry_id)        -- One placement per entry per class
```

**Indexes:**
```sql
CREATE INDEX idx_results_class_id ON results(class_id);
CREATE INDEX idx_results_entry_id ON results(entry_id);
CREATE INDEX idx_results_place ON results(place);
```

**Relationships:**
- Many-to-One: results → classes (class_id)
- Many-to-One: results → entries (entry_id)
- One-to-Many: results → result_audit

**Notes:**
- Manual placement entry (no automated scoring)
- Unique constraint prevents duplicate placements
- is_tie allows tracking of tied results
- Audit trail tracked in result_audit table

---

### 13. **result_audit**
Audit trail for result changes.

```sql
CREATE TABLE result_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES users(id),
  old_place INTEGER,
  new_place INTEGER,
  changed_at TIMESTAMPTZ DEFAULT now()
);
```

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| result_id | UUID | FK → results | Which result was changed |
| changed_by | UUID | FK → users | User who made change |
| old_place | INTEGER | | Previous placement |
| new_place | INTEGER | | New placement |
| changed_at | TIMESTAMPTZ | DEFAULT now() | When change was made |

**Indexes:**
```sql
CREATE INDEX idx_result_audit_result_id ON result_audit(result_id);
CREATE INDEX idx_result_audit_changed_by ON result_audit(changed_by);
CREATE INDEX idx_result_audit_changed_at ON result_audit(changed_at);
```

**Relationships:**
- Many-to-One: result_audit → results (result_id)
- Many-to-One: result_audit → users (changed_by)

**Notes:**
- Complete audit trail of all result changes
- Tracks who made changes and when
- Immutable record of all edits

---

## Data Integrity

### Cascading Deletes
- Deleting a show cascades to: rings, divisions, classes, entries, results, show_entries
- Deleting a class cascades to: entries, results
- Deleting an entry cascades to: results
- Deleting a result cascades to: result_audit

### Audit Trail
- result_audit tracks all changes to results
- created_at timestamps on all tables
- changed_by tracks which user made changes

---

## Key Queries

### Get all entries for a class with exhibitor info
```sql
SELECT 
  e.id, e.back_number, 
  ex.full_name, h.name as horse_name,
  r.place, r.notes
FROM entries e
JOIN exhibitors ex ON e.exhibitor_id = ex.id
JOIN horses h ON e.horse_id = h.id
LEFT JOIN results r ON e.id = r.entry_id
WHERE e.class_id = $class_id
ORDER BY COALESCE(r.place, 999), e.created_at;
```

### Get results for a class
```sql
SELECT 
  r.place, ex.full_name, h.name as horse_name,
  e.back_number, r.notes, r.is_tie
FROM results r
JOIN entries e ON r.entry_id = e.id
JOIN exhibitors ex ON e.exhibitor_id = ex.id
JOIN horses h ON e.horse_id = h.id
WHERE r.class_id = $class_id
ORDER BY r.place;
```

### Get result change history
```sql
SELECT 
  ra.changed_at, u.full_name, 
  ra.old_place, ra.new_place
FROM result_audit ra
LEFT JOIN users u ON ra.changed_by = u.id
WHERE ra.result_id = $result_id
ORDER BY ra.changed_at DESC;
```

---

## Performance Considerations

### Indexes Summary
- Foreign key columns indexed for join performance
- Status columns indexed for filtering
- Date columns indexed for range queries
- back_number indexed for lookup

### Query Optimization
- Pre-index common filter combinations (show_id + status)
- Consider materialized view for class results
- Batch operations for bulk entry/result creation

---

## Migration Strategy

### Version 1.0 (Current)
- All tables as described above
- Core functionality for show management

### Future Enhancements
- Scoring/time tracking (if rule-based results added)
- Exhibitor ratings/statistics view
- Report generation tables
- Photo/video storage

---

