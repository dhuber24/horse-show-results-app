-- 134: a competition card is a year's card, so the app stores the year.
--
-- APHA gates its Amateur, Novice Amateur, Amateur Walk-Trot, Novice Youth and
-- Youth Walk-Trot 11-18 divisions on a card the exhibitor holds, and every one
-- of those cards runs January 1 - December 31 and is renewed annually
-- (apha.com/competition/amateurs: "Amateur cards run January 1-December 31 and
-- must be renewed annually"; APHA's own entry form carries the notice "ALL APHA
-- AMATEUR, NOVICE AMATEUR, AMATEUR WALK TROT, NOVICE YOUTH AND YOUTH WALK TROT
-- 11-18 CARDS EXPIRE DECEMBER 31ST").
--
-- So the expiry is NOT a column. It is `December 31 of valid_year`, derived in
-- `backend/competition_cards.py` the way a horse's age is derived from its
-- foaling date. A date box here would accept 2026-06-30, which is not a card
-- APHA issues, and the desk would then be reading a wrong expiry off a screen
-- that looked authoritative. The noun everybody at the counter uses is "a 2026
-- Amateur card"; that is what the row holds.
--
-- Why a table rather than more columns on `exhibitors`. Migration 010 added
-- amateur_card_number / amateur_card_expiry / amateur_novice_codes -- one
-- association, one card, and a comma-separated string for the categories. That
-- is the same shape migration 117 had to unpick for membership numbers: a
-- person legitimately holds an Amateur card and a Novice Amateur card in the
-- same year, and holds them with a particular association. One row per
-- (exhibitor, association, division) is the fact.
--
-- `division` reuses the vocabulary `entries.apha_division` already speaks
-- (migration 115), because a card is what entitles an entry to name that
-- division -- two lists for one concept is how they drift. YOUTH and
-- YOUTH_WALK_TROT_5_10 are deliberately absent: APHA's notice does not list
-- them, youth eligibility being a matter of age and youth membership rather
-- than a card. OPEN and SOLID_PAINT_BRED need no card by definition.
--
-- Which associations issue which cards is NOT in the CHECK. It lives in
-- `competition_cards.CARD_DIVISIONS_BY_ASSOCIATION`, which currently knows only
-- APHA -- AQHA's card rules have not been supplied, and offering a card the app
-- has invented rules for is worse than offering none.
--
-- The legacy columns are backfilled and left in place, for the reason 117 left
-- apha_member_number alone: dropping the sole home of somebody's card number is
-- not a migration.

BEGIN;

CREATE TABLE IF NOT EXISTS exhibitor_competition_cards (
    id              UUID PRIMARY KEY,
    exhibitor_id    UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    association_id  UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    division        TEXT NOT NULL,
    card_number     TEXT,
    valid_year      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ
);

-- Stated separately from CREATE TABLE: backend startup runs
-- `Base.metadata.create_all`, so on a database that has not seen this migration
-- the table may already exist from the model -- without the server defaults and
-- SQL-only constraints, which are applied in Python there. Same trap migration
-- 114 documents.
ALTER TABLE exhibitor_competition_cards
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE exhibitor_competition_cards
    ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_exhibitor_competition_cards_division'
    ) THEN
        ALTER TABLE exhibitor_competition_cards
            ADD CONSTRAINT ck_exhibitor_competition_cards_division
            CHECK (division IN (
                'AMATEUR',
                'NOVICE_AMATEUR',
                'AMATEUR_WALK_TROT',
                'NOVICE_YOUTH',
                'YOUTH_WALK_TROT_11_18'
            ));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_exhibitor_competition_cards_valid_year'
    ) THEN
        ALTER TABLE exhibitor_competition_cards
            ADD CONSTRAINT ck_exhibitor_competition_cards_valid_year
            CHECK (valid_year BETWEEN 1962 AND 2100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_exhibitor_competition_cards_exhibitor_association_division'
    ) THEN
        ALTER TABLE exhibitor_competition_cards
            ADD CONSTRAINT uq_exhibitor_competition_cards_exhibitor_association_division
            UNIQUE (exhibitor_id, association_id, division);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_exhibitor_competition_cards_exhibitor
    ON exhibitor_competition_cards (exhibitor_id);

-- Backfill the one card migration 010 could describe: an APHA Amateur card.
-- The year comes off the legacy expiry, which was always a 31 December date in
-- practice -- and where it was not, the year is still the competition year that
-- expiry fell in, which is the fact being recovered.
INSERT INTO exhibitor_competition_cards (id, exhibitor_id, association_id, division, card_number, valid_year)
SELECT gen_random_uuid(),
       e.id,
       a.id,
       'AMATEUR',
       NULLIF(btrim(e.amateur_card_number), ''),
       EXTRACT(YEAR FROM e.amateur_card_expiry)::INTEGER
FROM exhibitors e
CROSS JOIN associations a
WHERE a.code = 'APHA'
  AND e.amateur_card_expiry IS NOT NULL
  AND EXTRACT(YEAR FROM e.amateur_card_expiry) BETWEEN 1962 AND 2100
  AND NOT EXISTS (
      SELECT 1 FROM exhibitor_competition_cards c
      WHERE c.exhibitor_id = e.id
        AND c.association_id = a.id
        AND c.division = 'AMATEUR'
  );

COMMENT ON TABLE exhibitor_competition_cards IS
    'A competition card the exhibitor holds for one division with one '
    'association, for one competition year. Expiry is derived -- 31 December '
    'of valid_year -- never stored: APHA''s cards run 1 January to 31 December '
    'and are renewed annually.';

COMMENT ON COLUMN exhibitor_competition_cards.valid_year IS
    'The competition year the card is good for. The card expires 31 December '
    'of this year; renewing means raising it, not editing a date.';

COMMENT ON COLUMN exhibitor_competition_cards.card_number IS
    'What is printed on the card, where it differs from the association '
    'membership number. NULL is ordinary -- an APHA amateur card carries the '
    'member''s own APHA number.';

INSERT INTO _migrations (name) VALUES ('134_exhibitor_competition_cards.sql')
ON CONFLICT DO NOTHING;

COMMIT;
