# Database

PostgreSQL schema for horse show management system.

## Core Entities

### Shows
Horse show events with dates and venues.

**Fields:**
- `id` (UUID, PK)
- `name` (TEXT)
- `venue` (TEXT) - legacy field
- `venue_id` (UUID, FK)
- `start_date` (DATE)
- `end_date` (DATE)
- `status` (TEXT) - DRAFT, ACTIVE, COMPLETED
- `created_at` (TIMESTAMPTZ)

**Relationships:**
- One show has many Rings
- One show has many Divisions
- One show has many Classes
- One show has many Entries (via classes)
- One show has many Results (via classes)
- One show has many Show Entries (exhibitor registrations)

---

### Rings
Performance areas/rings within a show for simultaneous competitions.

**Fields:**
- `id` (UUID, PK)
- `show_id` (UUID, FK)
- `name` (TEXT)

**Relationships:**
- One ring belongs to one Show
- One ring has many Classes

**Notes:**
- Multiple rings support simultaneous competitions
- Deleted with show (ON DELETE CASCADE)

---

### Divisions
Competition divisions within a show (e.g., Youth, Amateur, Open).

**Fields:**
- `id` (UUID, PK)
- `show_id` (UUID, FK)
- `name` (TEXT)

**Relationships:**
- One division belongs to one Show
- One division has many Classes

**Notes:**
- Organize competitors by skill level
- Deleted with show (ON DELETE CASCADE)

---

### Classes
Competition classes (specific events within a show).

**Fields:**
- `id` (UUID, PK)
- `show_id` (UUID, FK)
- `ring_id` (UUID, FK) - optional
- `division_id` (UUID, FK) - optional
- `class_number` (TEXT)
- `class_name` (TEXT)
- `class_date` (DATE)
- `status` (TEXT) - OPEN, IN_PROGRESS, COMPLETED
- `created_at` (TIMESTAMPTZ)

**Relationships:**
- One class belongs to one Show
- One class belongs to one Ring (optional)
- One class belongs to one Division (optional)
- One class has many Entries
- One class has many Results

**Notes:**
- Ring and division are optional (nullable)
- Status tracks class progression
- class_number uniquely identifies within show

---

### Entries
Entry of an exhibitor and horse combination into a specific class.

**Fields:**
- `id` (UUID, PK)
- `class_id` (UUID, FK)
- `exhibitor_id` (UUID, FK)
- `horse_id` (UUID, FK)
- `back_number` (INTEGER)
- `status` (TEXT) - ENTERED, WITHDRAWN, DISQUALIFIED
- `created_at` (TIMESTAMPTZ)

**Unique Constraint:**
- `(class_id, exhibitor_id, horse_id)` - prevents duplicate entries

**Relationships:**
- One entry belongs to one Class
- One entry belongs to one Exhibitor
- One entry belongs to one Horse
- One entry has one Result (optional)

**Notes:**
- Unique constraint prevents same exhibitor/horse in class twice
- back_number per class entry
- Status tracks entry lifecycle

---

### Results
Competition results (placings only, manual entry).

**Fields:**
- `id` (UUID, PK)
- `class_id` (UUID, FK)
- `entry_id` (UUID, FK)
- `place` (INTEGER) - 1st, 2nd, 3rd, etc.
- `is_tie` (BOOLEAN)
- `notes` (TEXT)
- `created_at` (TIMESTAMPTZ)

**Constraints:**
- `place > 0` - placement must be positive
- `(class_id, place, entry_id)` - unique placement per entry per class

**Relationships:**
- One result belongs to one Class
- One result belongs to one Entry
- One result has many Result Audit entries

**Notes:**
- Manual placement entry only (no automated scoring)
- Unique constraint prevents duplicate placements
- `is_tie` allows tracking of tied results
- Audit trail tracked in `result_audit` table

---

## Supporting Entities

### Exhibitors
People who exhibit in shows.

**Fields:**
- `id` (UUID, PK)
- `full_name` (TEXT)
- `user_id` (UUID, FK) - optional
- `created_at` (TIMESTAMPTZ)

**Relationships:**
- One exhibitor can be linked to one User
- One exhibitor has many Entries
- One exhibitor has many Show Entries
- One exhibitor has many Horses (via exhibitor_horses)

**Notes:**
- Can exist without user account
- user_id allows exhibitor login (optional)

---

### Horses
Horse information.

**Fields:**
- `id` (UUID, PK)
- `name` (TEXT)
- `owner_name` (TEXT)
- `created_at` (TIMESTAMPTZ)

**Relationships:**
- One horse has many Entries
- One horse has many Exhibitors (via exhibitor_horses)

**Notes:**
- Represents individual horses competing
- Owner tracked separately from exhibitor

---

### Exhibitor Horses
Junction table linking exhibitors to horses they exhibit.

**Fields:**
- `id` (UUID, PK)
- `exhibitor_id` (UUID, FK)
- `horse_id` (UUID, FK)
- `created_at` (TIMESTAMPTZ)

**Unique Constraint:**
- `(exhibitor_id, horse_id)` - prevents duplicate relationships

**Relationships:**
- Many-to-One: exhibitor_horses → Exhibitors
- Many-to-One: exhibitor_horses → Horses

**Notes:**
- Tracks which horses each exhibitor can ride
- Unique constraint prevents duplicates

---

### Show Entries
Exhibitor registration for a show (back number assignment).

**Fields:**
- `id` (UUID, PK)
- `show_id` (UUID, FK)
- `exhibitor_id` (UUID, FK)
- `back_number` (INTEGER)
- `created_at` (TIMESTAMPTZ)

**Unique Constraints:**
- `(show_id, exhibitor_id)` - one entry per exhibitor per show
- `(show_id, back_number)` - back numbers unique within show

**Relationships:**
- Many-to-One: show_entries → Shows
- Many-to-One: show_entries → Exhibitors

**Notes:**
- Tracks show-level registration
- back_number is unique per show
- Separate from class entries (Entries table)

---

### Users
System users with role-based access control.

**Fields:**
- `id` (UUID, PK)
- `role` (TEXT) - ADMIN, SCOREKEEPER, EXHIBITOR
- `full_name` (TEXT)
- `email` (TEXT, UNIQUE)
- `hashed_password` (TEXT)
- `created_at` (TIMESTAMPTZ)

**Relationships:**
- One user can be linked to many Exhibitors
- One user can create many Shows
- One user can create many Result Audit entries

---

### Venues
Physical locations where horse shows are held.

**Fields:**
- `id` (UUID, PK)
- `name` (TEXT)
- `address` (TEXT)
- `city` (TEXT)
- `state` (TEXT)
- `created_at` (TIMESTAMPTZ)

**Relationships:**
- One venue has many Shows

---

### Result Audit
Audit trail for result changes.

**Fields:**
- `id` (UUID, PK)
- `result_id` (UUID, FK)
- `changed_by` (UUID, FK)
- `old_place` (INTEGER)
- `new_place` (INTEGER)
- `changed_at` (TIMESTAMPTZ)

**Relationships:**
- Many-to-One: result_audit → Results
- Many-to-One: result_audit → Users

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
- `result_audit` table tracks all changes to results
- `created_at` timestamps on all tables
- `changed_by` tracks which user made changes

---

## Common Queries

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

### Get results for a class (class placings)
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

### Get result change history (audit trail)
```sql
SELECT 
  ra.changed_at, u.full_name, 
  ra.old_place, ra.new_place
FROM result_audit ra
LEFT JOIN users u ON ra.changed_by = u.id
WHERE ra.result_id = $result_id
ORDER BY ra.changed_at DESC;
```

### Get all entries for a show
```sql
SELECT 
  se.id, se.back_number,
  ex.full_name, h.name as horse_name
FROM show_entries se
JOIN exhibitors ex ON se.exhibitor_id = ex.id
WHERE se.show_id = $show_id
ORDER BY se.back_number;
```

---

## Performance Considerations

### Indexes
- Foreign key columns indexed for join performance
- Status columns indexed for filtering
- Date columns indexed for range queries
- back_number indexed for lookup
- (show_id, exhibitor_id) indexed for unique constraint
- (class_id, exhibitor_id, horse_id) indexed for unique constraint

### Query Optimization
- Use indexes for WHERE clauses with status or dates
- Join exhibitor_horses through exhibitors table
- Pre-index common filter combinations

---

## Migration Strategy

### Version 1.0 (Current)
- All tables as described above
- Core functionality for show management
- Manual result entry only

### Future Enhancements
- Scoring/time tracking (if rule-based results added)
- Exhibitor ratings/statistics view
- Report generation tables
- Photo/video storage
- Export functionality (PDF, Excel)

---

## Database Setup

### Create Database
```bash
createdb horse_show_db
```

### Connect
```bash
psql horse_show_db
```

### Run Schema
```bash
psql horse_show_db < database/schema.sql
```

---
