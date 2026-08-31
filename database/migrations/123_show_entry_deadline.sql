-- 123: the day a show's entries close.
--
-- APHA SC-090.C measures the approval-application deadline against "the show or
-- contest entry deadline or show date, whichever comes first". The app held only
-- the show date, so the only deadline it could compute was the *later* of the
-- two -- the unsafe direction, telling a manager they had 95 days to apply when
-- entries closed in 60 and the true answer was "a late penalty fee applies".
--
-- Records only. It does not close self-registration and it does not fire the
-- `post_entry` fee. Both are decisions about money and access that belong to
-- whoever makes them deliberately, and wiring either to a column added for a
-- deadline calculation would silently change what a show charges.
ALTER TABLE shows ADD COLUMN IF NOT EXISTS entry_deadline DATE;

COMMENT ON COLUMN shows.entry_deadline IS
    'The day entries close. Records only: does not gate self-registration and does not trigger the post-entry fee. Read by the APHA SC-090.C/D approval window, which counts back from this or start_date, whichever is earlier.';
