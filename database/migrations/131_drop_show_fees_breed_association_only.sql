-- 131: Drop show_fees.breed_association_only (migration 130).
--
-- It was an opt-in flag: a show's own automatic charge (an all-day pass, a
-- drug fee) could be told to count only the breed association's own classes,
-- excluding ones a club like WSCA or MNSPHC sanctions outright. In practice
-- there was no real case for the other choice -- a show with no club
-- sanctioning set up (most shows) has no club-sanctioned classes to exclude,
-- so scoping is a no-op there, and every real example found (a hand-built
-- "APHA All Day fee") wanted it on. `billing.charge_lines` now scopes every
-- automatic charge this way unconditionally, the same way `per_judge_per_entry`
-- (SC-125.B) always has, so the column has nothing left to say.

ALTER TABLE show_fees
  DROP COLUMN IF EXISTS breed_association_only;
