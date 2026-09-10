-- 137: which classes an automatic charge actually applies to.
--
-- Found on a live show. The MNSPHC Paint-O-Rama fee catalogue carries an "APHA
-- Youth class" rate, an "All Breed WSCA class" rate, an "MNSPHC All Breed class"
-- rate, and two All Day fees -- one for Open/Amateur/Novice Amateur and one for
-- Youth. Every one of them is an automatic unit, so `billing.charge_lines`
-- billed all five to every exhibitor who entered anything. An amateur with one
-- $36 class was charged $552: the youth rate, both club rates and *both* All Day
-- fees, none of which had anything to do with what they entered.
--
-- Migration 131 already scopes every automatic charge to "not a club-sanctioned
-- class". That is one coarse rule and it is the only one the app had. It cannot
-- say "Youth classes only", which is the distinction the whole top half of that
-- catalogue is drawn on.
--
-- So: a join table, deliberately the same shape as `class_sanctioning`
-- (migration 113), which exists because a club approving a *list of classes* is
-- not a property of the show. A charge applying to a list of classes is not a
-- property of the show either.
--
-- **Empty means every class**, not no class. Almost every fee at almost every
-- show applies to the whole schedule, so the absence of rows has to be the
-- ordinary case -- and a migration that made an unscoped fee bill nothing would
-- silently zero every existing show's bill. Scoping is therefore *narrowing*:
-- with rows, the counts an automatic unit multiplies are taken over those
-- classes alone, and an exhibitor who entered none of them owes nothing.
--
-- It **narrows, never widens.** Migration 131's club-sanctioned exclusion still
-- applies on top: naming a WSCA class here does not make the breed body's
-- assessment reach it. A club's own money is `show_sanctioning` +
-- `class_sanctioning`, and that is the other half of this same question read
-- from the club's side.
--
-- Only meaningful on an automatic unit. A reserved fee bills from a quantity
-- somebody booked and a price-list row bills nobody, so neither has a count for
-- this to narrow. Enforced in the router rather than by a CHECK, for the reason
-- `min_quantity` and the early rate are: the unit families live in billing.py,
-- not in the schema.

BEGIN;

CREATE TABLE IF NOT EXISTS show_fee_classes (
    id UUID PRIMARY KEY,
    show_fee_id UUID NOT NULL REFERENCES show_fees(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL
);

-- Stated apart from the CREATE TABLE: backend startup runs `create_all` and may
-- have built this from the model before the migration lands, in which case
-- `IF NOT EXISTS` skips and leaves a table with no server defaults. Migration
-- 114 learned this and 136 saw it happen.
ALTER TABLE show_fee_classes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_fee_classes ALTER COLUMN created_at SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS show_fee_classes_fee_class_uniq
    ON show_fee_classes (show_fee_id, class_id);

-- `billing.charge_lines` reads every scoped class for a show's fees at once.
CREATE INDEX IF NOT EXISTS show_fee_classes_class_idx
    ON show_fee_classes (class_id);

COMMENT ON TABLE show_fee_classes IS
    'Which classes an automatic show_fees charge applies to. No rows means the '
    'whole schedule, which is the ordinary case -- rows narrow it. Migration '
    '131''s club-sanctioned exclusion still applies on top; this never widens a '
    'charge, only restricts it.';

INSERT INTO _migrations (name) VALUES ('137_show_fee_classes.sql')
ON CONFLICT DO NOTHING;

COMMIT;
