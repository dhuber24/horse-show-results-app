-- 130: Whether an automatic charge counts only the breed association's own
-- classes, or every entry the way it always has.
--
-- A real show bill made this visible: two hand-built rows, "APHA All Day fee
-- — Open, Amateur & Novice Amateur (one horse)" at $180.00 and its Youth
-- counterpart at $140.00, both `per_horse`, both with a note reading "$45 per
-- judge x 4 APHA judges, one horse, APHA classes only. Does not include APHA
-- fees; All Breed (MNSPHC or WSCA) classes ... are not included." The
-- secretary had already worked out the rule and the arithmetic by hand —
-- $45 x 4 judges = $180 — and typed the scope into a notes field, because
-- nothing on the row itself could say "only horses entered in an APHA class
-- count toward this."
--
-- `per_judge_per_entry` already carries exactly this scoping unconditionally
-- (migration 125's SC-125.B assessment is definitionally the breed body's
-- own), but a show's *own* invented charge — an all-day pass, a drug fee that
-- only applies to breed classes, whatever a club dreams up — is not always
-- shaped like that, and was not offered the choice at all. This is that
-- choice, off by default so every existing fee (including the two rows
-- above) keeps billing exactly as it does today until a manager ticks it.

ALTER TABLE show_fees
  ADD COLUMN IF NOT EXISTS breed_association_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN show_fees.breed_association_only IS
  'When true, an automatic charge (per_horse, per_judge_per_horse, '
  'per_judge_per_exhibitor) counts only horses/entries in the breed '
  'association''s own classes -- excluding classes a club (WSCA, MNSPHC, '
  'etc.) sanctions outright, which already carry their own price. '
  'per_judge_per_entry is always scoped this way regardless of this column, '
  'because that unit is the breed body''s own per-entry assessment '
  '(SC-125.B and its kin) by definition. Meaningless outside the automatic '
  'family; see backend/routers/show_fees.py for the guard.';
