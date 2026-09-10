-- 136: a registration somebody started and did not finish.
--
-- Registration is five steps and the first *per-show* write is the third one.
-- Steps one and two -- your details, your horses -- write to `exhibitors` and
-- `horses`, which belong to the person and not to the weekend; `PUT /signup` is
-- what creates the `show_entries` row. So an exhibitor who opened a show's
-- registration screen, read what it would cost, and closed the tab to go and
-- find the horse's Coggins left **no trace against that show at all**. My Shows
-- finds you through a `show_entries` row or a class entry, and they had
-- neither. The next time they thought about it, nothing anywhere reminded them
-- which show they had been part-way through.
--
-- One row per (show, exhibitor), written when they open the screen. Two things
-- it is deliberately not:
--
-- * **Not a `show_entries` shell row.** That shape already exists -- NULL
--   `registered_at` is what the office creates while adding a late entry by
--   hand -- and reusing it would put every window-shopper on the show's desk
--   roster, inflating the "no back number" and "no entries" counts the office
--   works down. The desk's roster is people the show is expecting; this is
--   people who looked.
--
-- * **Not a record of progress.** No step column. How far somebody got is
--   derivable -- the profile checklist and their horse count already answer it,
--   and they are answered fresh on every read -- and a stored copy would go
--   stale the moment they completed their profile from `/profile` instead.
--   What is *not* derivable is the intent: that they were looking at this show.
--   That is the whole content of the row.
--
-- It is a bookmark, so it is disposable in both directions. Signing up deletes
-- it (the `show_entries` row is the record from then on), dismissing it deletes
-- it, and opening the screen again writes it back -- somebody who returns to
-- the form has changed their mind, and there is nothing here worth keeping to
-- argue otherwise. Reads also filter to shows still PUBLISHED: registration
-- closes with that status, so a bookmark for a show that has started points at
-- a form nobody can submit.

BEGIN;

CREATE TABLE IF NOT EXISTS show_registration_drafts (
    id UUID PRIMARY KEY,
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    last_opened_at TIMESTAMPTZ NOT NULL
);

-- Stated separately from the CREATE TABLE above, and the ids are supplied by
-- the caller rather than defaulted: backend startup runs `create_all` and may
-- have built this table from the model before the migration lands, in which
-- case `CREATE TABLE IF NOT EXISTS` skips and leaves a table with no server
-- defaults at all. Migration 114 learned this the hard way.
ALTER TABLE show_registration_drafts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_registration_drafts ALTER COLUMN started_at SET DEFAULT now();
ALTER TABLE show_registration_drafts ALTER COLUMN last_opened_at SET DEFAULT now();

-- One bookmark per person per show. The upsert on open depends on this.
CREATE UNIQUE INDEX IF NOT EXISTS show_registration_drafts_show_exhibitor_uniq
    ON show_registration_drafts (show_id, exhibitor_id);

-- My Shows reads every draft for one exhibitor.
CREATE INDEX IF NOT EXISTS show_registration_drafts_exhibitor_idx
    ON show_registration_drafts (exhibitor_id);

COMMENT ON TABLE show_registration_drafts IS
    'An exhibitor opened a show''s registration screen and has not signed up. '
    'A bookmark for My Shows, not a roster row -- the office''s roster is '
    'show_entries, and a person who only looked does not belong on it. Deleted '
    'when they sign up, and when they dismiss it.';

COMMENT ON COLUMN show_registration_drafts.started_at IS
    'First time they opened the registration screen for this show.';

COMMENT ON COLUMN show_registration_drafts.last_opened_at IS
    'Most recent time. What My Shows sorts on -- the show they were looking at '
    'yesterday is the one they meant to come back to.';

INSERT INTO _migrations (name) VALUES ('136_show_registration_drafts.sql')
ON CONFLICT DO NOTHING;

COMMIT;
