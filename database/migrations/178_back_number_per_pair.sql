-- 178: a back number per exhibitor-and-horse pair, the third way a show can
-- number.
--
-- Migration 161 gave a show two answers to "whose is a back number?": the
-- exhibitor's (one per person, on `show_entries.back_number`) or the horse's
-- (one per horse, on `show_horse_numbers`, as APHA SC-160.D requires). Some
-- show companies do neither. They number each *combination* -- this exhibitor
-- on this horse -- so somebody who brings three horses wears three numbers, as
-- at a horse-numbered show, but a horse shown by a youth and then an amateur
-- wears two, because each of them is a different entry in the ring. Neither of
-- the two tables can hold that: one has a row per person, the other a row per
-- horse.
--
-- 1. `shows.back_number_per` gains `pair`. The CHECK is dropped and made again
--    with the third value; the column, its default and every existing show are
--    unchanged.
--
-- 2. `show_pair_numbers` -- one row per (show, exhibitor, horse), unique on
--    (show, back_number), with `preferred_back_number` mirroring the column on
--    `show_entries` (migration 104): what was asked for, as against what the
--    show issued. Its own table rather than an `exhibitor_id` on
--    `show_horse_numbers`, for the reason 161 gave horses a table of their own:
--    a show reads one kind and never compares them, so switching a show from
--    one kind to another leaves the other kinds' numbers where they are,
--    unread, and switching back restores them. Sharing a table would make the
--    horse kind and the pair kind collide on (show, back_number).
--
--    `exhibitor_id` cascades like `horse_id`, so deleting a record takes its
--    numbers with it. A merge of two exhibitor records moves them first
--    (`exhibitor_merge.merge_exhibitors`), as it does every other row keyed on
--    the exhibitor.
--
-- A widened CHECK and a new table: backward-compatible, so it goes to
-- production before the code -- the code still running never writes `pair`,
-- and its schema refuses the value. Written to survive `create_all` making the
-- table first -- IF NOT EXISTS throughout, the server defaults in their own
-- statements.

BEGIN;

ALTER TABLE shows DROP CONSTRAINT IF EXISTS ck_shows_back_number_per;
ALTER TABLE shows
    ADD CONSTRAINT ck_shows_back_number_per
    CHECK (back_number_per IN ('exhibitor', 'horse', 'pair'));

CREATE TABLE IF NOT EXISTS show_pair_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    back_number INTEGER,
    preferred_back_number INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_pair_numbers_pair UNIQUE (show_id, exhibitor_id, horse_id),
    CONSTRAINT uq_show_pair_numbers_number UNIQUE (show_id, back_number)
);

ALTER TABLE show_pair_numbers ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_pair_numbers ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON COLUMN shows.back_number_per IS 'Who a back number belongs to at this show: exhibitor (show_entries.back_number, one per person), horse (show_horse_numbers, one per horse, as APHA SC-160.D requires) or pair (show_pair_numbers, one per exhibitor per horse). Migrations 161 and 178.';

COMMENT ON TABLE show_pair_numbers IS 'An exhibitor''s back number on one horse at one show, read when shows.back_number_per = ''pair''. Two exhibitors on one horse wear two numbers. Migration 178.';

INSERT INTO _migrations (name) VALUES ('178_back_number_per_pair.sql')
ON CONFLICT DO NOTHING;

COMMIT;
