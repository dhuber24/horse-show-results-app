-- Migration 063: Fix default_score_type on standard_divisions
-- All rows were seeded with server_default='placement'. Update to reflect
-- actual scoring type per discipline, mirroring backend/rules/disciplines.py.

-- Time events first (most unambiguous)
UPDATE standard_divisions SET default_score_type = 'time'
WHERE lower(name) LIKE '%barrel%'
   OR lower(name) LIKE '%pole bending%'
   OR lower(name) LIKE '%stake race%'
   OR lower(name) LIKE '%goat tying%'
   OR lower(name) LIKE '%breakaway roping%'
   OR lower(name) LIKE '%tie-down roping%'
   OR lower(name) LIKE '%team roping%'
   OR lower(name) LIKE '%mounted shooting%';

-- Pattern events (scored numerically, highest wins)
UPDATE standard_divisions SET default_score_type = 'pattern'
WHERE lower(name) LIKE '%showmanship%'
   OR lower(name) LIKE '%trail%'
   OR lower(name) LIKE '%reining%'
   OR lower(name) LIKE '%western horsemanship%'
   OR lower(name) LIKE '%horsemanship%'
   OR lower(name) LIKE '%equitation%'
   OR lower(name) LIKE '%cutting%'
   OR lower(name) LIKE '%working cow horse%'
   OR lower(name) LIKE '%western riding%'
   OR lower(name) LIKE '%ranch riding%'
   OR lower(name) LIKE '%ranch reining%'
   OR lower(name) LIKE '%ranch cutting%'
   OR lower(name) LIKE '%ranch cow work%'
   OR lower(name) LIKE '%ranch trail%'
   OR lower(name) LIKE '%timed ranch trail%'
   OR lower(name) LIKE '%western dressage%'
   OR lower(name) LIKE '%dressage%'
   OR lower(name) LIKE '%jumping%'
   OR lower(name) LIKE '%hunt seat equitation%'
   OR lower(name) LIKE '%equitation over fences%'
   OR lower(name) LIKE '%hunter hack%'
   OR lower(name) LIKE '%working hunter%'
   OR lower(name) LIKE '%longe line%'
   OR lower(name) LIKE '%in-hand trail%'
   OR lower(name) LIKE '%in hand trail%';

-- Everything else remains 'placement' (halter, western pleasure,
-- hunter under saddle, driving, color, lead line, all around, etc.)
