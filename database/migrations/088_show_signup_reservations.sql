-- Migration 088: sign up for the show before you enter its classes.
--
-- Class entry used to be the first and only thing an exhibitor told the show.
-- Everything else the office needs to run the grounds — how many stalls, how
-- many bags of shavings, whether a camper is coming — was collected off-app and
-- retyped, and the exhibitor's bill was only ever the class fees.
--
-- Sign-up makes the show-level record the deliberate first step. `show_entries`
-- already *was* the show-level record (it is what carries the back number), so
-- it gains `registered_at` rather than gaining a sibling table: a row with a
-- timestamp is a completed sign-up, a row without one is the shell the
-- secretary auto-created when adding a late entry by hand.
--
-- Reservations point at `show_fees` instead of restating stall/shavings/camping
-- as columns. The secretary already configures those rows with real prices and
-- units; a fixed set of columns would mean a second place to configure them and
-- would silently drop the tack stall or the second camping tier a show offers.
-- What the exhibitor may reserve is derived from the fee's `unit` — per_stall,
-- per_bag, per_night — so a custom fee row priced by the stall shows up in the
-- picker without anyone touching this schema.
--
-- Backfill sets registered_at from created_at on every existing show_entries
-- row: people who already registered are signed up, and must not be locked out
-- of a show they are already entered in.

BEGIN;

ALTER TABLE show_entries
    ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS arrival_date DATE,
    ADD COLUMN IF NOT EXISTS departure_date DATE,
    ADD COLUMN IF NOT EXISTS registration_notes TEXT;

UPDATE show_entries
SET registered_at = COALESCE(created_at, now())
WHERE registered_at IS NULL;

CREATE TABLE IF NOT EXISTS show_entry_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_entry_id UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    -- CASCADE: a fee the secretary deleted is no longer bookable, and a
    -- reservation quantity against a price that no longer exists cannot be
    -- billed. The exhibitor's remaining reservations are unaffected.
    show_fee_id UUID NOT NULL REFERENCES show_fees(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (show_entry_id, show_fee_id)
);

CREATE INDEX IF NOT EXISTS idx_show_entry_reservations_entry
    ON show_entry_reservations (show_entry_id);

COMMENT ON COLUMN show_entries.registered_at IS
    'When the exhibitor completed show sign-up. NULL = shell row created by staff, sign-up not done.';
COMMENT ON TABLE show_entry_reservations IS
    'Quantities an exhibitor reserved against this show''s fee catalog (stalls, shavings, camping).';
COMMENT ON COLUMN show_entry_reservations.show_fee_id IS
    'The show_fees row being reserved. Reservable fees are those with unit per_stall / per_bag / per_night.';

INSERT INTO _migrations (name) VALUES ('088_show_signup_reservations.sql')
ON CONFLICT DO NOTHING;

COMMIT;
