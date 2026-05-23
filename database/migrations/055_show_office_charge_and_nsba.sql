-- Migration 055: One-time-per-horse office charge on shows + seed NSBA show type
-- so per-class NSBA sanction fees can be auto-computed at registration time.
--
-- Real NSBA-style billing has two surcharges that are NOT per-class entry_fee:
--
-- 1. NSBA sanction fee. Per NSBA's official sanction-fees rule, every entry into
--    an NSBA-approved class owes max($3, 6% of entry fee), regardless of whether
--    the exhibitor shows the class. The fee is computed from the existing
--    `class_associations` row pointing at NSBA — no per-class storage required.
--
-- 2. Office/admin charge. Levied once per horse per show, covers drug testing and
--    office overhead. The NSBA World Show charges $75/horse, smaller shows vary.
--    Stored at the show level so secretaries set it once.
--
-- Migration is additive: existing shows default to $0 office charge; NSBA seeding
-- is idempotent. No backfill required.

ALTER TABLE shows
    ADD COLUMN office_charge_cents INTEGER NOT NULL DEFAULT 0
        CHECK (office_charge_cents >= 0);

INSERT INTO show_types (id, code, name, config) VALUES
    (gen_random_uuid(), 'NSBA', 'National Snaffle Bit Association', '{}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('055_show_office_charge_and_nsba.sql');
