-- 155: how each class is placed, as the office names it -- four card types.
--
-- A class already carried `score_type` (placement / pattern / time), which is
-- what the scribe screens and the ranking read, and a pattern class could carry
-- a judge's-card sheet (`judging_system_id`, migration 122). What the show
-- office actually chooses between is four kinds of card:
--
--   placing     Placing Cards -- rank order, 1st, 2nd, 3rd; the rail classes.
--   scored      Scored / Numeric Cards -- maneuvers or fences scored with
--               deductions: reining, cutting, trail, hunter over fences.
--   equitation  Equitation / Pattern Cards -- rider position, accuracy and
--               precision through a set pattern, on the ground or mounted:
--               showmanship, horsemanship, equitation.
--   timed       Timed -- the clock places the class.
--
-- Scored and equitation both place by score, so `score_type` cannot tell them
-- apart; that is what `classes.card_type` records. **`score_type` stays the
-- engine's field** -- dozens of paths branch on 'pattern' -- and the Scoring
-- step writes both together (placing -> placement, scored/equitation ->
-- pattern, timed -> time). NULL means nobody has chosen, and the card type is
-- derived (`backend/card_types.py`); a stored value that no longer agrees with
-- `score_type` is ignored the same way, so the two cannot drift into a class
-- that is listed one way and scored another.
--
-- `judging_systems.card_type` says which of the two score-based types a sheet
-- belongs to, so the Scoring step offers an equitation class only equitation
-- sheets. The three sheets on file are classified here.
--
-- Two nullable columns with CHECKs no existing row can fail: backward-
-- compatible, so it goes to production before the code.

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS card_type TEXT;
ALTER TABLE judging_systems ADD COLUMN IF NOT EXISTS card_type TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_classes_card_type') THEN
        ALTER TABLE classes
            ADD CONSTRAINT ck_classes_card_type
            CHECK (card_type IS NULL OR card_type IN ('placing', 'scored', 'equitation', 'timed'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_judging_systems_card_type') THEN
        ALTER TABLE judging_systems
            ADD CONSTRAINT ck_judging_systems_card_type
            CHECK (card_type IS NULL OR card_type IN ('scored', 'equitation'));
    END IF;
END $$;

UPDATE judging_systems SET card_type = 'scored'
WHERE code = 'apha_cow_work' AND card_type IS NULL;

UPDATE judging_systems SET card_type = 'equitation'
WHERE code IN ('apha_equitation_flat', 'apha_equitation_over_fences') AND card_type IS NULL;

COMMENT ON COLUMN classes.card_type IS
    'How the class is placed, as the office chose it (migration 155): placing, '
    'scored, equitation or timed. Written with score_type by the Scoring step; '
    'NULL, or a value that disagrees with score_type, means derived '
    '(backend/card_types.py).';

COMMENT ON COLUMN judging_systems.card_type IS
    'Which score-based card type this sheet belongs to: scored or equitation. '
    'NULL is offered to both.';

INSERT INTO _migrations (name) VALUES ('155_class_card_types.sql')
ON CONFLICT DO NOTHING;

COMMIT;
