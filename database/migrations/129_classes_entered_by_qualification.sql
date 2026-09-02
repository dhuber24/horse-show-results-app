-- 129: Classes you qualify into, rather than enter.
--
-- A Grand & Reserve Champion halter class is not entered at registration. The
-- first- and second-place horses from each qualifying class are called back
-- once those classes have been judged, so at the moment an exhibitor is
-- filling in their entry form there is nothing to sign up for. Every one of
-- these on a real schedule was sitting in the exhibitor's class picker, priced
-- at $0, waiting to be entered by anybody who scrolled far enough.
--
-- A column rather than a name test at the point of entry, because the name is
-- only ever a *guess* and somebody has to be able to correct it. This mirrors
-- `classes.score_type`, which is derived from the discipline when a class is
-- created and stored thereafter: `rules.disciplines.entered_by_qualification`
-- seeds the value, the column is the authority, and the class list screen can
-- tick or untick it.
--
-- What this does NOT do is work out who qualified. That would mean knowing
-- which classes feed which championship -- class "2-3 Grand & Reserve Amateur
-- Stallions" draws from the Amateur stallion age classes -- and the app holds
-- no such relationship. The show office enters the call-backs from the desk,
-- which is where they are standing when the judge calls them. So this closes
-- the exhibitor's door and leaves the office's open, which is the same shape
-- as every other rule where staff know something the app does not.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS entered_by_qualification BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN classes.entered_by_qualification IS
  'TRUE when entries come from placing in a qualifying class (Grand & Reserve '
  'Champion call-backs), not from registration. Exhibitor self-registration '
  'refuses these; the show office enters them from the desk. Seeded from the '
  'class name by rules.disciplines.entered_by_qualification, then owned by '
  'whoever edits the class.';

-- Backfill, mirroring `_QUALIFYING_ONLY_RE` in backend/rules/disciplines.py.
-- The two have to agree, and this is the only place they are written twice:
-- the Python one seeds new classes, this one catches the shows that already
-- exist. Narrow on purpose -- "champion" alone is not enough, because a
-- Hi-Point champion is an award rather than a class and a show may legitimately
-- name an ordinary class something with the word in it.
UPDATE classes
   SET entered_by_qualification = TRUE
 WHERE entered_by_qualification = FALSE
   AND class_name ~* '(\ygrand\s*(&|and|/)\s*reserve\y|\yreserve\s*(&|and|/)\s*grand\y|\ygrand\s+champion(ship)?\y|\yreserve\s+champion(ship)?\y)';
