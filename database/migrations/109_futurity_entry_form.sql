-- Migration 109: the futurity entry form, as the show office writes it.
--
-- Migration 107 modelled what a futurity *charges* — tiered per-class rates, a
-- deadline with a late fee, an office fee that follows club membership, and
-- Hi-Point divisions scored over a named subset of classes. That is the half of
-- a futurity the app has to do arithmetic on, and it was the right half first.
--
-- What it did not model is the half a futurity is actually published as: a one
-- page entry form. The North Star Futurity form states its deadline to the
-- minute, names the awards (Hi-Point saddle, Reserve Hi-Point buckle), tells
-- entrants that breed-association crossover rules do not apply to futurity
-- classes, explains the three fee categories before asking them to pick one,
-- sells an optional club membership alongside the office fee, states a refund
-- policy, and ends in a release that must be signed before the horse may show.
--
-- None of that had anywhere to live, so a show that set a futurity up in this
-- app produced a programme which priced correctly and said nothing. This
-- migration gives those words a home next to the money, and adds the two things
-- on the form that are neither: the optional membership being sold, and the
-- exhibitor name for when the owner is not the one showing the horse.
--
-- ── Why the deadline grows a time but the billing does not ────────────────────
-- `entered_at` is a DATE and lateness is decided by comparing it to
-- `entry_deadline` (migration 107). A 7:00 PM cutoff is what the form prints,
-- not a second clock for the biller to read: an entry taken on the 19th is on
-- time whatever the app knows about the hour. `entry_deadline_time` is display
-- precision, and the CHECK keeps it from existing without a date to qualify.
--
-- ── Why a membership is a row and not a `show_fees` line ──────────────────────
-- The club membership on the form is sold *by the futurity*, priced by the
-- futurity, and bought at the moment of enrollment. A `show_fees` row would be
-- reservable by anyone at the show, would bill through
-- `show_entry_reservations` rather than the futurity line, and would leave "did
-- this entrant join?" answerable in two places that could disagree with
-- `futurity_entries.is_member`. ON DELETE RESTRICT for the same reason as
-- `fee_tier_id`: an option somebody bought is a price they were quoted.

BEGIN;

-- ── The words on the form ─────────────────────────────────────────────────────

ALTER TABLE futurities
    ADD COLUMN IF NOT EXISTS entry_deadline_time TIME,
    ADD COLUMN IF NOT EXISTS entry_deadline_timezone TEXT,
    ADD COLUMN IF NOT EXISTS entry_instructions TEXT,
    ADD COLUMN IF NOT EXISTS award_notice TEXT,
    ADD COLUMN IF NOT EXISTS rules_notice TEXT,
    ADD COLUMN IF NOT EXISTS refund_policy TEXT,
    -- A futurity is an age-restricted programme judged in age divisions, so the
    -- foaling date, sire and dam are entry-form fields rather than nice extras.
    -- Default true because that is what every futurity form asks for; a show
    -- which does not care can turn it off.
    ADD COLUMN IF NOT EXISTS requires_horse_pedigree BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_futurities_deadline_time'
    ) THEN
        ALTER TABLE futurities ADD CONSTRAINT ck_futurities_deadline_time
            CHECK (entry_deadline_time IS NULL OR entry_deadline IS NOT NULL);
    END IF;
END $$;

COMMENT ON COLUMN futurities.entry_deadline_time IS
    'Display precision on the deadline ("by 7:00 PM"). Lateness is still decided by futurity_entries.entered_at against entry_deadline — this is what the form prints, not a second clock.';
COMMENT ON COLUMN futurities.entry_deadline_timezone IS
    'Free-text zone label as printed ("central time"). A label, not a tz database name: nothing computes with it.';
COMMENT ON COLUMN futurities.entry_instructions IS
    'The PLEASE READ block explaining the fee categories before the entrant picks one.';
COMMENT ON COLUMN futurities.award_notice IS
    'What the futurity hands out and who is eligible, in the words the show publishes.';
COMMENT ON COLUMN futurities.rules_notice IS
    'Standing rules for the futurity classes, e.g. that breed-association crossover restrictions do not apply.';
COMMENT ON COLUMN futurities.refund_policy IS
    'What happens to an entry fee when the horse does not show.';

-- ── Awards have names ─────────────────────────────────────────────────────────
--
-- A Hi-Point division computes a ranking; what the winner receives is the
-- reason anybody entered. Two columns rather than an awards table: every
-- futurity form seen so far names a champion award and a reserve, and a table
-- would invite a places-deep payout schedule this programme does not have.

ALTER TABLE futurity_divisions
    ADD COLUMN IF NOT EXISTS award_name TEXT,
    ADD COLUMN IF NOT EXISTS reserve_award_name TEXT;

COMMENT ON COLUMN futurity_divisions.award_name IS
    'What the division champion receives, e.g. Hi-Point Saddle.';
COMMENT ON COLUMN futurity_divisions.reserve_award_name IS
    'What the reserve champion receives, e.g. Reserve Hi-Point Buckle.';

-- ── The optional club membership sold on the form ─────────────────────────────

CREATE TABLE IF NOT EXISTS futurity_membership_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    futurity_id UUID NOT NULL REFERENCES futurities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_futurity_membership_options_name UNIQUE (futurity_id, name)
);

CREATE INDEX IF NOT EXISTS futurity_membership_options_futurity_idx
    ON futurity_membership_options (futurity_id, sort_order);

COMMENT ON TABLE futurity_membership_options IS
    'Optional club memberships the futurity sells at entry (Single $30 / Household $40). Buying one is not the same fact as futurity_entries.is_member, which decides the office fee — an entrant may already hold a card.';

-- ── What the entrant filled in ────────────────────────────────────────────────

ALTER TABLE futurity_entries
    ADD COLUMN IF NOT EXISTS membership_option_id UUID
        REFERENCES futurity_membership_options(id) ON DELETE RESTRICT,
    -- "Exhibitor if different than owner". Free text on purpose: the person
    -- showing a two-year-old is often a trainer or a youth with no account
    -- here, and demanding a linked record would stop the entry being taken.
    --
    -- Named `shown_by_name` rather than `exhibitor_name` because every payload
    -- carrying it also carries the account holder's name, read off
    -- `show_entries` -> `exhibitors`. Two different people, and calling both of
    -- them the exhibitor is how one silently overwrites the other.
    ADD COLUMN IF NOT EXISTS shown_by_name TEXT;

CREATE INDEX IF NOT EXISTS futurity_entries_membership_option_idx
    ON futurity_entries (membership_option_id);

COMMENT ON COLUMN futurity_entries.membership_option_id IS
    'The club membership this entrant bought with their entry, if any. Billed on the futurity line, once per enrollment.';
COMMENT ON COLUMN futurity_entries.shown_by_name IS
    'Who is showing the horse when that is not the owner. Free text, matching the paper form. Not the account holder — that is show_entries -> exhibitors.';

-- ── A waiver may belong to a futurity ─────────────────────────────────────────
--
-- The release on the entry form is a waiver in every sense this app already
-- models one (migration 099): free text the show writes, signed once by each
-- exhibitor, recordable on paper at the counter, guardian-aware for youth
-- entrants. What it is not is show-wide — only futurity entrants are asked for
-- it, and asking everybody would put a permanent outstanding item on the
-- paperwork of people who never entered.
--
-- So a waiver is scoped rather than duplicated. NULL is the existing meaning:
-- every exhibitor at the show is asked.

ALTER TABLE show_waivers
    ADD COLUMN IF NOT EXISTS futurity_id UUID
        REFERENCES futurities(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS show_waivers_futurity_idx ON show_waivers (futurity_id);

COMMENT ON COLUMN show_waivers.futurity_id IS
    'When set, only exhibitors enrolled in that futurity are asked to sign. NULL means show-wide, which is what every pre-109 waiver is.';

INSERT INTO _migrations (name) VALUES ('109_futurity_entry_form.sql')
ON CONFLICT DO NOTHING;

COMMIT;
