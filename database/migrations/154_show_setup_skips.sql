-- 154: which setup steps the show office said do not apply to this show.
--
-- The wizard's optional steps -- Judges, Lodging, Sanctioning, Futurities, Side
-- Pots, Fees, Judge Cards -- have offered a *Skip* since they were built, but a
-- skip went nowhere except the next step: nothing remembered it. So a show that
-- runs no futurity and no side pots carried both, at full size, in the tab bar,
-- on the setup hub and on the show dashboard for the rest of its life, looking
-- exactly like work nobody had got round to. Recording the answer is what lets
-- those places tuck the step away (minimized in the wizard, a greyed-out tile
-- on the dashboard) instead of asking again every time somebody manages the show.
--
-- One row per (show, step). `step` is a wizard key, checked against the
-- skippable steps by the router rather than a CHECK, so a step becoming
-- skippable needs no migration.
--
-- **A skip only counts while the step is empty.** That is decided on read, not
-- stored: somebody who skipped Side Pots and later sets one up has plainly
-- changed their mind, and the step comes back without anybody having to undo
-- the skip first. The row is left in place, which is harmless -- it is inert
-- until the step is empty again.
--
-- A new table: backward-compatible, so it goes to production before the code.

BEGIN;

CREATE TABLE IF NOT EXISTS show_setup_skips (
    show_id            UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    step               TEXT NOT NULL,
    skipped_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    skipped_at         TIMESTAMPTZ,
    PRIMARY KEY (show_id, step)
);

-- Stated separately: backend startup may have built the table from the model
-- before this ran, and then CREATE TABLE IF NOT EXISTS skips (migration 114).
ALTER TABLE show_setup_skips ALTER COLUMN skipped_at SET DEFAULT now();

COMMENT ON TABLE show_setup_skips IS
    'Setup steps the show office said do not apply to this show. Counted only '
    'while the step is still empty; the wizard minimizes a skipped step and the '
    'show dashboard greys out its tile.';

INSERT INTO _migrations (name) VALUES ('154_show_setup_skips.sql')
ON CONFLICT DO NOTHING;

COMMIT;
