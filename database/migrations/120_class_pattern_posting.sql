-- Migration 120: when the pattern went up.
--
-- Every pattern class in the rule book opens the same way: "It is mandatory that
-- the judge post the pattern at least one hour prior to the commencement of the
-- class" (AM-115.B.2, YP-120.B.2, the hunt-seat equitation class procedure). It
-- is one of the few show-management duties stated as mandatory with a deadline
-- attached, and the app had nowhere to record that it happened.
--
-- Two columns, and neither of them is the pattern itself.
--
--   pattern_posted_at — when it went up. The compliance fact.
--   pattern_notes     — which pattern, in the judge's own words. Free text
--                       because it is usually a reference to a numbered pattern
--                       in the rule book ("Green Western Riding Pattern #1"),
--                       sometimes a description, and the app has no business
--                       supplying a vocabulary for something a judge designs.
--
-- **The app does not store the pattern.** A pattern is posted physically at the
-- show — on a board by the gate — and the rule is about that. Recording an image
-- here would create a second copy that can silently disagree with the one
-- exhibitors actually walked, which is worse than no copy: somebody would ride
-- what the screen said. The same reasoning keeps the show bill generated rather
-- than uploaded.
--
-- Nothing is enforced. A pattern posted 55 minutes before is a fact for the
-- office to see, not an entry to refuse — refusing it would not have posted the
-- pattern any earlier, which is the same reasoning that took the block off
-- health paperwork.

BEGIN;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS pattern_posted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pattern_notes TEXT;

COMMENT ON COLUMN classes.pattern_posted_at IS
    'When the judge posted this class''s pattern. The rules require it at least '
    'one hour before the class; this records that it happened, and nothing '
    'refuses a class over it.';

COMMENT ON COLUMN classes.pattern_notes IS
    'Which pattern, in the judge''s words — usually a reference to a numbered '
    'pattern in the rule book. The pattern itself is posted physically at the '
    'show and is deliberately not stored here.';

INSERT INTO _migrations (name) VALUES ('120_class_pattern_posting.sql')
ON CONFLICT DO NOTHING;

COMMIT;
