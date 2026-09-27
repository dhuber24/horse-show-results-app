-- 146: the show's patterns, on file and assigned to the classes that run them.
--
-- Migration 120 recorded *when* a class's pattern went up and deliberately did
-- not store the pattern, on the grounds that a second copy could disagree with
-- the one posted at the in-gate and somebody would ride it. That was the same
-- argument that kept the show bill generated until migration 127, and it gave
-- way for the same reason: shows already publish their patterns ahead of the
-- weekend -- e-mailed, pinned to a club page, photographed and passed round the
-- barn aisle -- and refusing the upload did not stop a second copy existing. It
-- stopped it being one the office could replace, or that an exhibitor could find
-- from the class they are entered in.
--
-- So the hazard is re-homed rather than dismissed:
--
--   * **One current file per pattern.** A judge who changes a pattern has it
--     replaced in place (`file_uploaded_at` moves; the classes stay assigned),
--     so there is no superseded version anybody can still open from here.
--   * **The replacement time is on every reader**, and the exhibitor's page says
--     the pattern posted at the in-gate is the official one.
--   * `classes.pattern_posted_at` still records that the judge posted it at the
--     show. An upload a week before is not that, and does not set it.
--
-- Two tables.
--
-- `show_patterns` is the library: a name somebody reads ("Showmanship Pattern
-- 2"), optional notes, and the file -- shaped after `show_documents`, bytes in
-- the row, MIME sniffed from the magic bytes. Many per show, unlike a show bill,
-- and named rather than typed, because a show runs a dozen of them.
--
-- `show_pattern_classes` is which pattern each class runs, keyed on the class:
-- a class runs one pattern, and one pattern (a showmanship pattern, say) often
-- runs a dozen classes. A join table rather than `classes.pattern_id` because
-- `classes` is read on nearly every path in the app, and a column the running
-- release does not know about there is how migration 133 took the site down --
-- a new table cannot fail that way. The class and the pattern must belong to the
-- same show; the router enforces that, since a CHECK cannot see another table.

BEGIN;

CREATE TABLE IF NOT EXISTS show_patterns (
    id                  UUID PRIMARY KEY,
    show_id             UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    notes               TEXT,
    original_filename   TEXT NOT NULL,
    file_data           BYTEA NOT NULL,
    mime_type           TEXT NOT NULL,
    file_size           INTEGER NOT NULL,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ,
    file_uploaded_at    TIMESTAMPTZ
);

-- Stated separately from the CREATE TABLE: backend startup runs `create_all`,
-- which may have built this table from the model before the migration lands,
-- in which case `CREATE TABLE IF NOT EXISTS` skips and leaves a table with none
-- of what follows (migration 114's lesson). A new table, so SET NOT NULL is safe.
ALTER TABLE show_patterns ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE show_patterns ALTER COLUMN file_uploaded_at SET DEFAULT now();
ALTER TABLE show_patterns ALTER COLUMN file_uploaded_at SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_patterns_name'
    ) THEN
        ALTER TABLE show_patterns
            ADD CONSTRAINT ck_show_patterns_name
            CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_patterns_notes_length'
    ) THEN
        ALTER TABLE show_patterns
            ADD CONSTRAINT ck_show_patterns_notes_length
            CHECK (notes IS NULL OR char_length(notes) <= 2000);
    END IF;
END $$;

-- Two patterns called "Trail" at one show would leave an exhibitor guessing
-- which one their class runs. Case-insensitive, like the class-name rule.
CREATE UNIQUE INDEX IF NOT EXISTS show_patterns_show_name_uniq
    ON show_patterns (show_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS show_pattern_classes (
    class_id    UUID PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
    pattern_id  UUID NOT NULL REFERENCES show_patterns(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ
);

ALTER TABLE show_pattern_classes ALTER COLUMN assigned_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS show_pattern_classes_pattern_idx
    ON show_pattern_classes (pattern_id);

COMMENT ON TABLE show_patterns IS
    'Patterns a show put on file for exhibitors to read, each assigned to the '
    'classes that run it through show_pattern_classes. The pattern posted at the '
    'in-gate remains the official one; classes.pattern_posted_at records that.';

COMMENT ON COLUMN show_patterns.file_uploaded_at IS
    'When the current file went up. Moves when the file is replaced -- a judge '
    'changing a pattern -- and is printed beside the pattern on every reader.';

COMMENT ON TABLE show_pattern_classes IS
    'Which pattern a class runs. One per class (the key); a pattern may run many '
    'classes. Class and pattern belong to the same show, enforced in the router.';

INSERT INTO _migrations (name) VALUES ('146_show_patterns.sql')
ON CONFLICT DO NOTHING;

COMMIT;
