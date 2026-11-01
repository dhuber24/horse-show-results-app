-- 177: a photo of the judge's card, attached to its class.
--
-- A scribe enters the total the judge called and the app ranks the class; the
-- card itself -- every maneuver, penalty and note in the judge's own hand --
-- stays on paper. Exhibitors want to see it, the way they read the pattern
-- before the class (migration 146). So the scribe photographs the card from
-- the scribe screen, and the photo hangs off the class.
--
-- One row per photo, so a panel of three judges is three photos and a card
-- that runs to two sheets is two. `judge_id` says whose card it is, by the
-- same assignment `results.judge_id` names (migration 095); NULL is the
-- unattributed card, as it is there. A photo is never replaced in place --
-- a better one is a new row and the blurry one is removed -- so a photo's id
-- always names the same bytes.
--
-- A photo is read publicly only once the class's results are posted
-- (`classes.results_published_at`): the card *is* the placings, and showing it
-- early would post the class before the scribe did.
--
-- A new table: backward-compatible, so this goes to production before the code.

BEGIN;

CREATE TABLE IF NOT EXISTS class_card_photos (
    id                  UUID PRIMARY KEY,
    class_id            UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    judge_id            UUID REFERENCES show_judges(id) ON DELETE SET NULL,
    file_data           BYTEA NOT NULL,
    mime_type           TEXT NOT NULL,
    file_size           INTEGER NOT NULL,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ
);

-- Stated separately from the CREATE TABLE: backend startup runs `create_all`,
-- which may have built this table from the model before the migration lands,
-- in which case `CREATE TABLE IF NOT EXISTS` skips it (migration 114's lesson).
ALTER TABLE class_card_photos ALTER COLUMN created_at SET DEFAULT now();

-- Every read is one class's photos.
CREATE INDEX IF NOT EXISTS class_card_photos_class_idx ON class_card_photos (class_id);

COMMENT ON TABLE class_card_photos IS
    'Photos of a judge''s card, attached to the class. Public once the class''s results are posted.';
COMMENT ON COLUMN class_card_photos.judge_id IS
    'Whose card: the show_judges assignment, as on results.judge_id. NULL is the unattributed card.';

INSERT INTO _migrations (name) VALUES ('177_class_card_photos.sql')
ON CONFLICT DO NOTHING;

COMMIT;
