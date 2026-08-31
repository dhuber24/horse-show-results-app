-- Migration 122: the judge's card.
--
-- What the app holds today is one typed number per entry per judge. A real card
-- is a base score, a run of maneuver or fence scores, and penalties deducted
-- from the total — and the number in `results.raw_score` is the *output* of
-- that arithmetic, done on paper and then keyed in.
--
-- There is no single card shape. The rules supplied contain three incompatible
-- systems: equitation on the flat scores maneuvers -3 to +3 in half points with
-- penalties in fixed 3/5/10 tiers; Equitation Over Fences (AM-111.F) scores each
-- fence -1.5 to +1.5 on a 0-100 scale against a table of roughly thirty-five
-- penalties, a third of which are ranges the judge picks within; cow work
-- (SC-265.E) uses 1/3/5 penalties carrying letter codes. So the card cannot be a
-- table with fixed columns — the scale is declared per system and the sheet is
-- built from whichever applies.
--
--   judging_systems   — how a card is marked. Scale, base, unit, step.
--   judging_penalties — that system's named penalties. Fixed value, or a range
--                       the judge chooses within.
--   judge_cards       — one worksheet: this entry, this class, this judge.
--   card_maneuvers    — the per-maneuver (or per-fence) scores on it.
--   card_penalties    — the penalties applied to it.
--
-- **`judge_cards` is keyed on (class, entry, judge), not on a `results` row.**
-- `bulk_save_results` is a delete-all-then-insert-all within one judge's card and
-- the scribe screens autosave on a 1.5s settle, so anything hanging off
-- `results.id` by foreign key would be destroyed every time somebody typed. The
-- card identifies itself by the same three things a result does.
--
-- **The card computes; the result records.** `computed_score` is derived from
-- the card by `backend/judging.py`. `override_score` is a human disagreeing with
-- the arithmetic, which happens — and is why CLAUDE.md's "does not calculate
-- penalties" line is being amended deliberately rather than eroded: a card the
-- app refuses to add up is a scan with extra steps, and a card held next to a
-- separately typed total is two numbers that will eventually disagree. The
-- effective score is `COALESCE(override_score, computed_score)` and it is what
-- reaches `results.raw_score` through the ordinary save path, so `results` keeps
-- exactly one writer.
--
-- **What is seeded, and what is not.** The scales and the penalty *tiers* are in
-- the rule text supplied and are seeded. The thirty-five named penalties behind
-- AM-111.F are not, and inventing labels under APHA's name would be worse than
-- an empty list — so `card_penalties.label` is free text alongside the optional
-- catalog pointer, and a scribe can always record what the judge actually
-- called. `judging_systems.notes` says which numbers came from the rule book.

BEGIN;

CREATE TABLE IF NOT EXISTS judging_systems (
    id UUID PRIMARY KEY,
    -- NULL means generic — available whatever the show type. Points at
    -- `show_types` rather than `associations` for the same reason
    -- `association_standard_classes` does: how a class is scored is the breed
    -- body's catalog question, not a property of a horse or a person.
    show_type_id UUID REFERENCES show_types(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    -- Where the card starts before anything is added or taken off. NULL means
    -- the total is the sum of the maneuvers alone.
    base_score NUMERIC(10, 3),
    -- The per-maneuver adjustment the judge may make, and the increment.
    maneuver_min NUMERIC(10, 3) NOT NULL,
    maneuver_max NUMERIC(10, 3) NOT NULL,
    maneuver_step NUMERIC(10, 3) NOT NULL,
    -- What one row of the card is called, and how many there are. `unit_count`
    -- NULL means the class decides — a trail pattern has as many obstacles as
    -- the judge built.
    unit_label TEXT NOT NULL,
    unit_count INTEGER,
    score_max NUMERIC(10, 3),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS judging_penalties (
    id UUID PRIMARY KEY,
    system_id UUID NOT NULL REFERENCES judging_systems(id) ON DELETE CASCADE,
    code TEXT,
    label TEXT NOT NULL,
    -- Exactly one of these two shapes. A fixed penalty carries `value`; one the
    -- judge chooses within carries the bounds and the scribe records what was
    -- called. AM-111.F's table is about a third the second kind.
    value NUMERIC(10, 3),
    min_value NUMERIC(10, 3),
    max_value NUMERIC(10, 3),
    -- 'run' applies to the whole go; 'maneuver' is attached to one maneuver or
    -- fence, which is how a card marks where it happened.
    applies_to TEXT NOT NULL DEFAULT 'run',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS judge_cards (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    -- NULL is the unattributed card, exactly as on `results` (migration 095).
    judge_id UUID REFERENCES show_judges(id) ON DELETE CASCADE,
    system_id UUID REFERENCES judging_systems(id) ON DELETE SET NULL,
    computed_score NUMERIC(10, 3),
    override_score NUMERIC(10, 3),
    override_reason TEXT,
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_maneuvers (
    id UUID PRIMARY KEY,
    card_id UUID NOT NULL REFERENCES judge_cards(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    score NUMERIC(10, 3),
    label TEXT
);

CREATE TABLE IF NOT EXISTS card_penalties (
    id UUID PRIMARY KEY,
    card_id UUID NOT NULL REFERENCES judge_cards(id) ON DELETE CASCADE,
    -- Optional: the catalog is a convenience, not the vocabulary. A penalty the
    -- judge called that nobody has loaded is still a penalty, and refusing it
    -- would send the scribe looking for the nearest wrong answer.
    penalty_id UUID REFERENCES judging_penalties(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    value NUMERIC(10, 3) NOT NULL,
    -- Which maneuver or fence it happened on. NULL means the run as a whole.
    sequence INTEGER
);

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS judging_system_id UUID
        REFERENCES judging_systems(id) ON DELETE SET NULL;

-- Score corrections, alongside the placing corrections already recorded. An
-- override of the card's arithmetic is exactly the kind of editorial decision
-- this table exists for.
ALTER TABLE result_audit
    ADD COLUMN IF NOT EXISTS old_score NUMERIC(10, 3),
    ADD COLUMN IF NOT EXISTS new_score NUMERIC(10, 3);

-- Stated apart from the CREATE TABLEs: backend startup runs create_all, so on a
-- database where the models landed first these tables already exist without the
-- server defaults (the models apply theirs in Python) and without the CHECKs.
-- Migration 114 learned this the hard way.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'judging_penalties'::regclass
          AND conname = 'ck_judging_penalties_shape'
    ) THEN
        ALTER TABLE judging_penalties ADD CONSTRAINT ck_judging_penalties_shape CHECK (
            (value IS NOT NULL AND min_value IS NULL AND max_value IS NULL)
            OR (value IS NULL AND min_value IS NOT NULL AND max_value IS NOT NULL)
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'judging_penalties'::regclass
          AND conname = 'ck_judging_penalties_applies_to'
    ) THEN
        ALTER TABLE judging_penalties ADD CONSTRAINT ck_judging_penalties_applies_to
            CHECK (applies_to IN ('run', 'maneuver'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'card_maneuvers'::regclass
          AND conname = 'ck_card_maneuvers_sequence'
    ) THEN
        ALTER TABLE card_maneuvers ADD CONSTRAINT ck_card_maneuvers_sequence
            CHECK (sequence > 0);
    END IF;
END
$$;

ALTER TABLE judging_penalties ALTER COLUMN applies_to SET DEFAULT 'run';
ALTER TABLE judging_penalties ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE judging_penalties ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE judging_systems ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE judging_systems ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE judge_cards ALTER COLUMN updated_at SET DEFAULT now();

-- One catalog code per system, and one card per (class, entry, judge). The NULL
-- judge needs its own partial index: NULLs are distinct in a plain unique index,
-- so the unattributed card would accept duplicates. Same shape as migration 095.
CREATE UNIQUE INDEX IF NOT EXISTS judging_systems_code_uniq
    ON judging_systems (code);
CREATE UNIQUE INDEX IF NOT EXISTS judging_penalties_system_code_uniq
    ON judging_penalties (system_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS judge_cards_class_entry_judge_uniq
    ON judge_cards (class_id, entry_id, judge_id) WHERE judge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS judge_cards_class_entry_nojudge_uniq
    ON judge_cards (class_id, entry_id) WHERE judge_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS card_maneuvers_card_sequence_uniq
    ON card_maneuvers (card_id, sequence);
CREATE INDEX IF NOT EXISTS card_penalties_card_idx ON card_penalties (card_id);
CREATE INDEX IF NOT EXISTS judge_cards_class_idx ON judge_cards (class_id);

COMMENT ON TABLE judging_systems IS
    'How a judge''s card is marked: the base, the per-maneuver range and step, '
    'and what one row of the card is called. There is no single card shape — '
    'equitation on the flat, Equitation Over Fences and cow work use three '
    'incompatible ones — so the sheet is built from whichever applies.';

COMMENT ON COLUMN judging_systems.base_score IS
    'Where the card starts. NULL means the total is the sum of the maneuvers '
    'alone. Seeded at 70 and editable: the rule text fixes the adjustment '
    'ranges and penalty tiers, not the starting number for every class.';

COMMENT ON COLUMN judge_cards.override_score IS
    'A human disagreeing with the card''s arithmetic. The effective score is '
    'COALESCE(override_score, computed_score) and an override writes a '
    'result_audit row — the app computes the total, it does not insist on it.';

COMMENT ON COLUMN card_penalties.label IS
    'What the judge called, in words. Free text alongside the optional catalog '
    'pointer, because a penalty nobody has loaded is still a penalty and '
    'refusing it would send the scribe looking for the nearest wrong answer.';

-- ── Seed: the three systems the supplied rules describe ──────────────────────
--
-- Values taken from the rule text: the maneuver ranges, the half-point step and
-- the penalty tiers (3/5/10 for equitation, 1/3/5 for cow work). The base score
-- is the app's default rather than a citation, and `notes` says so on screen.
--
-- Ids are supplied explicitly because the models apply their default in Python;
-- a table create_all got to first has no DEFAULT on `id`.

INSERT INTO judging_systems (
    id, show_type_id, code, name, base_score,
    maneuver_min, maneuver_max, maneuver_step, unit_label, unit_count, score_max, notes
)
SELECT
    'aa000000-0000-4000-8000-000000000001'::uuid,
    st.id,
    'apha_equitation_flat',
    'Equitation / Horsemanship — on the flat',
    70, -3, 3, 0.5, 'Maneuver', NULL, NULL,
    'Maneuver range and half-point step from the hunt seat equitation class '
    'procedure; penalties in fixed 3, 5 and 10 point tiers. The base score of 70 '
    'is this app''s default, not a figure from the rule book — change it if your '
    'association scores from somewhere else.'
FROM show_types st WHERE st.code = 'APHA'
ON CONFLICT DO NOTHING;

INSERT INTO judging_systems (
    id, show_type_id, code, name, base_score,
    maneuver_min, maneuver_max, maneuver_step, unit_label, unit_count, score_max, notes
)
SELECT
    'aa000000-0000-4000-8000-000000000002'::uuid,
    st.id,
    'apha_equitation_over_fences',
    'Equitation Over Fences',
    70, -1.5, 1.5, 0.5, 'Fence', 8, 100,
    'AM-111.F — each fence scored -1.5 to +1.5 on a 0-100 scale. The eight '
    'fences and the base of 70 are defaults; set them to the course you built. '
    'AM-111.F''s table of roughly thirty-five named penalties is NOT loaded — '
    'about a third are ranges the judge chooses within, and inventing the labels '
    'would be worse than an empty list. Record what the judge called, with its '
    'value, on the card.'
FROM show_types st WHERE st.code = 'APHA'
ON CONFLICT DO NOTHING;

INSERT INTO judging_systems (
    id, show_type_id, code, name, base_score,
    maneuver_min, maneuver_max, maneuver_step, unit_label, unit_count, score_max, notes
)
SELECT
    'aa000000-0000-4000-8000-000000000003'::uuid,
    st.id,
    'apha_cow_work',
    'Cow work / Boxing',
    70, -3, 3, 0.5, 'Maneuver', NULL, NULL,
    'Penalty tiers of 1, 3 and 5 from SC-265.E, which also carry letter codes on '
    'the judge''s sheet. A zero and a No Score are separate outcomes on the '
    'result, not penalties (migration 121).'
FROM show_types st WHERE st.code = 'APHA'
ON CONFLICT DO NOTHING;

-- The penalty tiers. Named by their value because the value is what is cited and
-- the name is the association's to supply; a scribe records the judge's own
-- words in `card_penalties.label`.
-- Selected from judging_systems rather than listed flat, so that a database
-- with no APHA show_types row seeds nothing instead of failing the foreign key.
INSERT INTO judging_penalties (id, system_id, code, label, value, applies_to, sort_order)
SELECT p.id::uuid, s.id, p.code, p.label, p.value, 'maneuver', p.sort_order
FROM judging_systems s
JOIN (VALUES
    ('ab000000-0000-4000-8000-000000000001', 'apha_equitation_flat', 'P3',  '3-point penalty',  3::numeric,  1),
    ('ab000000-0000-4000-8000-000000000002', 'apha_equitation_flat', 'P5',  '5-point penalty',  5::numeric,  2),
    ('ab000000-0000-4000-8000-000000000003', 'apha_equitation_flat', 'P10', '10-point penalty', 10::numeric, 3),
    ('ab000000-0000-4000-8000-000000000004', 'apha_cow_work',        'P1',  '1-point penalty',  1::numeric,  1),
    ('ab000000-0000-4000-8000-000000000005', 'apha_cow_work',        'P3',  '3-point penalty',  3::numeric,  2),
    ('ab000000-0000-4000-8000-000000000006', 'apha_cow_work',        'P5',  '5-point penalty',  5::numeric,  3)
) AS p(id, system_code, code, label, value, sort_order)
  ON p.system_code = s.code
ON CONFLICT DO NOTHING;

INSERT INTO _migrations (name) VALUES ('122_judging_cards.sql')
ON CONFLICT DO NOTHING;

COMMIT;
