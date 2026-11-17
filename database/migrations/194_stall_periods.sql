-- 194: stall periods, what kind of stall a line sells, and a stall per horse.
--
-- WSCA's Championship Show sells the same box stall three ways: for the full
-- show (Wednesday 4 PM to Monday night), for the pleasure days only (out one
-- hour after your last class on Friday), and for the games days only (in no
-- earlier than 9 PM Friday, to Monday). Each has its own price, its own
-- move-in and its own move-out, and the same physical stall is sold to a
-- pleasure exhibitor and then to a games exhibitor. It also sells tie stalls,
-- and tack stalls that need a minimum number of horses in the same period.
--
-- `show_stall_periods` is one of those windows: a name, a move-in day and an
-- optional hour, a move-out day and an optional hour, and an optional note for
-- a move-out no clock states ("1 hour after your last class"). Wall-clock
-- values at the venue, printed as typed, the same call migration 181 made for
-- `shows.stalls_open_*`. A show with no periods sells every stall for the
-- whole show, which is every show before this.
--
-- On `show_fees`, three columns read only on a `per_stall` line:
--
-- * `stall_kind`: `horse` (a box or tie stall a horse stands in), `tack` (a
--   stall for tack, which needs no shavings and holds no horse) or `add_on`
--   (a charge priced per stall that is not a stall, such as the Early Move-In
--   Pass). NULL means not stated, and `stabling.stall_kind_of` reads it from
--   the line itself: the pass's code is an add-on, a label naming a tack stall
--   is a tack stall, anything else is a horse stall. So no row needs a
--   backfill, and a line created by the show bill import or a seed script is
--   read the same way.
-- * `stall_period_id`: the period the line is sold for. NULL is the whole
--   show. A period deleted from under a line leaves it a whole-show line.
-- * `horses_per_tack_stall`: on a tack stall, the fewest horse stalls the
--   exhibitor must hold in the same period for each tack stall they book.
--   WSCA: none for the pleasure days, 4 for the games days, 3 for the full
--   show. Flagged, never refused.
--
-- `shows.stall_per_horse_required`: the office's answer to "does every horse
-- entered need its own stall?" When it is set, an exhibitor whose horse
-- stalls do not cover each horse on each day it shows is told so, and so is
-- the desk. Nobody is refused: who pays for whose stall is often somebody else
-- (a parent, a trainer, a group), and only the office can sort that out.
--
-- A new table and nullable or defaulted columns: backward-compatible, so this
-- goes to production before the code.

BEGIN;

CREATE TABLE IF NOT EXISTS show_stall_periods (
    id             UUID PRIMARY KEY,
    show_id        UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    move_in_date   DATE NOT NULL,
    move_in_time   TIME,
    move_out_date  DATE NOT NULL,
    move_out_time  TIME,
    move_out_note  TEXT,
    sort_order     INTEGER NOT NULL,
    created_at     TIMESTAMPTZ
);

-- Defaults and CHECKs stated on their own: `create_all` may have built the
-- table from the model before this ran.
ALTER TABLE show_stall_periods ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_stall_periods ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE show_stall_periods ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE show_stall_periods DROP CONSTRAINT IF EXISTS ck_show_stall_periods_dates;
ALTER TABLE show_stall_periods ADD CONSTRAINT ck_show_stall_periods_dates
    CHECK (move_out_date >= move_in_date);

ALTER TABLE show_stall_periods DROP CONSTRAINT IF EXISTS ck_show_stall_periods_name;
ALTER TABLE show_stall_periods ADD CONSTRAINT ck_show_stall_periods_name
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);

CREATE INDEX IF NOT EXISTS show_stall_periods_show_idx
    ON show_stall_periods (show_id, sort_order);

COMMENT ON TABLE show_stall_periods IS
    'A window a stall is sold for (full show, pleasure days, games days): its own move-in and move-out, wall-clock at the venue. No rows means every stall is for the whole show.';
COMMENT ON COLUMN show_stall_periods.move_out_note IS
    'A move-out no clock states, e.g. "1 hour after your last class". Printed beside the move-out day.';

ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS stall_kind TEXT;
ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_stall_kind;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_stall_kind
    CHECK (stall_kind IS NULL OR stall_kind IN ('horse', 'tack', 'add_on'));

ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS stall_period_id UUID;
ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS fk_show_fees_stall_period;
ALTER TABLE show_fees ADD CONSTRAINT fk_show_fees_stall_period
    FOREIGN KEY (stall_period_id) REFERENCES show_stall_periods(id) ON DELETE SET NULL;

ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS horses_per_tack_stall SMALLINT;
ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_horses_per_tack_stall;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_horses_per_tack_stall
    CHECK (horses_per_tack_stall IS NULL OR horses_per_tack_stall BETWEEN 1 AND 20);

COMMENT ON COLUMN show_fees.stall_kind IS
    'On a per_stall line: horse, tack or add_on. NULL is read from the line (stabling.stall_kind_of).';
COMMENT ON COLUMN show_fees.stall_period_id IS
    'On a per_stall line: the stall period it is sold for. NULL is the whole show.';
COMMENT ON COLUMN show_fees.horses_per_tack_stall IS
    'On a tack stall: the fewest horse stalls in the same period for each tack stall booked. Flagged, never refused.';

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS stall_per_horse_required BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN shows.stall_per_horse_required IS
    'Every horse entered needs its own stall. Exhibitors whose horse stalls do not cover each horse on each day it shows are flagged; nobody is refused.';

INSERT INTO _migrations (name) VALUES ('194_stall_periods.sql')
ON CONFLICT DO NOTHING;

COMMIT;
