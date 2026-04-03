-- =====================================================
-- CORE ENTITIES
-- =====================================================

CREATE TABLE shows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    venue TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE TABLE divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    ring_id UUID REFERENCES rings(id),
    division_id UUID REFERENCES divisions(id),
    class_number TEXT NOT NULL,
    class_name TEXT NOT NULL,
    class_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | RESULTS_POSTED
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- PEOPLE & HORSES
-- =====================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL, -- ADMIN | SCOREKEEPER | EXHIBITOR
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE horses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- ENTRIES (CLASS SIGN‑UPS)
-- =====================================================

CREATE TABLE entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    rider_id UUID NOT NULL REFERENCES riders(id),
    horse_id UUID NOT NULL REFERENCES horses(id),
    back_number INTEGER,
    status TEXT NOT NULL DEFAULT 'ENTERED', -- ENTERED | SCRATCHED
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (class_id, rider_id, horse_id)
);

-- =====================================================
-- RESULTS (MANUAL PLACINGS ONLY)
-- =====================================================

CREATE TABLE results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    placing INTEGER NOT NULL CHECK (placing > 0),
    is_tie BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (class_id, placing, entry_id)
);

-- =====================================================
-- OPTIONAL: AUDIT LOG (RECOMMENDED)
-- =====================================================

CREATE TABLE result_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id UUID NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id),
    old_placing INTEGER,
    new_placing INTEGER,
    changed_at TIMESTAMPTZ DEFAULT now()
);