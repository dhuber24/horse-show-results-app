CREATE TABLE IF NOT EXISTS shows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    venue TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
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

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS horses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exhibitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id),
    horse_id UUID NOT NULL REFERENCES horses(id),
    back_number INTEGER,
    status TEXT NOT NULL DEFAULT 'ENTERED',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (class_id, exhibitor_id, horse_id)
);

-- Results (manual placings)
CREATE TABLE IF NOT EXISTS results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    place INTEGER NOT NULL CHECK (place > 0),
    is_tie BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (class_id, place, entry_id)
);

CREATE TABLE IF NOT EXISTS result_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id UUID NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    old_place INTEGER,
    new_place INTEGER,
    changed_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;

ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

ALTER TABLE shows ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT';

CREATE TABLE IF NOT EXISTS exhibitor_horses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (exhibitor_id, horse_id)
);

CREATE TABLE IF NOT EXISTS venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shows ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id);

CREATE TABLE IF NOT EXISTS show_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id),
    back_number INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (show_id, exhibitor_id),
    UNIQUE (show_id, back_number)
);
