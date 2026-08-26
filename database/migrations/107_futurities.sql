-- Migration 107: futurities as a first-class per-show program.
--
-- A futurity was previously a single `show_fees` row with code 'futurity' —
-- one flat per-entry amount sitting next to the jackpot fee in setup Step 5.
-- That cannot describe an actual futurity. The North Star Futurity prices one
-- class three ways depending on how the horse got there ($75 / $100 / $150),
-- closes entries at a stated deadline after which every class carries a $150
-- late fee, charges an office fee per horse that depends on club membership,
-- and hands out Hi-Point awards computed over a named subset of its classes.
-- None of that fits in an amount_cents.
--
-- Shaped after `side_pots`, which solved the same problem for jackpots: a named
-- program that spans several classes, that exhibitors opt into, and that has
-- standings. The differences are deliberate and all come from what a futurity
-- actually is.
--
-- ── A futurity entry is an enrollment, not a class entry ──────────────────────
-- The lettered futurity classes are ordinary `classes` rows and are entered
-- through ordinary `entries`. `futurity_entries` records that a *horse* is in
-- the program, at which fee tier, and whether its owner holds a club
-- membership. The money is then derived: tier rate x the horse's entries in the
-- futurity's classes, plus the office fee once, plus the late fee per class
-- when the enrollment postdates the deadline.
--
-- The consequence is that a futurity class carries `entry_fee_cents = 0`: the
-- class fee IS the futurity fee, and it depends on the entrant's category,
-- which a class row cannot know. Anything that seeds a futurity class with a
-- non-zero fee will double-charge.
--
-- ── `entered_at` is a stored date, never today ────────────────────────────────
-- Same rule as `show_entry_reservations.reserved_at`: the late fee is decided
-- by the day the enrollment was taken. Comparing against `now()` would apply a
-- late fee retroactively to everyone the moment the deadline passed.

BEGIN;

CREATE TABLE IF NOT EXISTS futurities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    -- Both optional: a futurity that never closes entries is a legitimate
    -- configuration, and a deadline with no late fee just means entries shut.
    entry_deadline DATE,
    late_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (late_fee_cents >= 0),
    office_fee_member_cents INTEGER NOT NULL DEFAULT 0
        CHECK (office_fee_member_cents >= 0),
    office_fee_nonmember_cents INTEGER NOT NULL DEFAULT 0
        CHECK (office_fee_nonmember_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_futurities_show_name UNIQUE (show_id, name)
);

CREATE INDEX IF NOT EXISTS futurities_show_id_idx ON futurities (show_id);

-- What an entrant pays per class, by category. A futurity with no tiers is
-- unenterable rather than free — the API refuses an entry with no tier.
CREATE TABLE IF NOT EXISTS futurity_fee_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    futurity_id UUID NOT NULL REFERENCES futurities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_futurity_fee_tiers_name UNIQUE (futurity_id, name)
);

CREATE INDEX IF NOT EXISTS futurity_fee_tiers_futurity_idx
    ON futurity_fee_tiers (futurity_id, sort_order);

-- Which classes belong to the program. CASCADE on class_id: deleting a class
-- removes it from the futurity, the same way it leaves a side pot.
CREATE TABLE IF NOT EXISTS futurity_classes (
    futurity_id UUID NOT NULL REFERENCES futurities(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    PRIMARY KEY (futurity_id, class_id)
);

-- ── Hi-Point awards ──────────────────────────────────────────────────────────
-- A division is an award bracket within the futurity (Yearling, 2 Year Old),
-- scored over a named subset of the futurity's classes.
CREATE TABLE IF NOT EXISTS futurity_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    futurity_id UUID NOT NULL REFERENCES futurities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Same vocabulary as side_pots.scoring_method, and for the same reason:
    -- the app has no points table, so "hi-point" is expressed as lowest total
    -- placing or highest total score. Do not invent a third scale here without
    -- deciding what a point is.
    scoring_method TEXT NOT NULL DEFAULT 'sum_placings'
        CHECK (scoring_method IN ('sum_placings', 'sum_scores')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_futurity_divisions_name UNIQUE (futurity_id, name)
);

CREATE INDEX IF NOT EXISTS futurity_divisions_futurity_idx
    ON futurity_divisions (futurity_id, sort_order);

-- Which classes count toward a division, and how.
--
-- `counts` is the ordinary case: the class contributes its result.
-- `best_of_group` is the North Star 2-Year-Old rule — "all three pleasure
-- classes may be entered, but only the one with the highest points is used".
-- Classes sharing a `group_name` within a division form one such bucket and
-- contribute exactly one result between them, the best by the division's
-- scoring method. Modelled per class rather than as a division-level "best N
-- of" count because the rule names a specific set: Halter and WT Trail always
-- count, and the pleasure classes compete for the third slot.
CREATE TABLE IF NOT EXISTS futurity_division_classes (
    futurity_division_id UUID NOT NULL
        REFERENCES futurity_divisions(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    scoring TEXT NOT NULL DEFAULT 'counts'
        CHECK (scoring IN ('counts', 'best_of_group')),
    group_name TEXT,
    PRIMARY KEY (futurity_division_id, class_id),
    -- A group name is meaningless on a class that always counts, and required
    -- on one that competes for a slot — otherwise there is no bucket to be
    -- best of.
    CONSTRAINT ck_futurity_division_classes_group CHECK (
        (scoring = 'counts' AND group_name IS NULL)
        OR (scoring = 'best_of_group' AND group_name IS NOT NULL)
    )
);

-- ── Enrollments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS futurity_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    futurity_id UUID NOT NULL REFERENCES futurities(id) ON DELETE CASCADE,
    show_entry_id UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    -- SET NULL rather than CASCADE, matching entries.horse_id: deleting a horse
    -- preserves the record that the enrollment happened and was charged for.
    horse_id UUID REFERENCES horses(id) ON DELETE SET NULL,
    -- RESTRICT: a tier with enrollments against it is a price somebody was
    -- quoted. Deleting it would silently reprice their bill to zero.
    fee_tier_id UUID REFERENCES futurity_fee_tiers(id) ON DELETE RESTRICT,
    is_member BOOLEAN NOT NULL DEFAULT false,
    entered_at DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_futurity_entries_horse UNIQUE (futurity_id, horse_id)
);

CREATE INDEX IF NOT EXISTS futurity_entries_futurity_idx
    ON futurity_entries (futurity_id);
CREATE INDEX IF NOT EXISTS futurity_entries_show_entry_idx
    ON futurity_entries (show_entry_id);

INSERT INTO _migrations (name) VALUES ('107_futurities.sql')
ON CONFLICT DO NOTHING;

COMMIT;
