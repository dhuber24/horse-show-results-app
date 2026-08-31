-- Migration 117: a membership number without its expiry date is half a fact.
--
-- `exhibitor_registrations` is the registry every affiliation reads from since
-- migration 080 — one row per (exhibitor, association) holding the membership
-- number. It has never held when that membership runs out, so the desk could
-- show a secretary an APHA number and nothing about whether it is still good.
--
-- APHA membership in good standing is a condition of showing (RG-030), and the
-- office is the last chance to catch a lapsed card, so this is exactly the fact
-- the check-in sheet exists to surface.
--
-- The APHA-shaped columns on `exhibitors` — apha_member_number and
-- apha_member_expiry, from migration 010 — are the pre-080 way of saying the
-- same thing for one association only. They are backfilled into the registry
-- here and left in place: some records carry a number only there, and the APHA
-- export still falls back to them. Nothing is dropped, because dropping a column
-- that is the sole home of somebody's membership number is not a migration, it
-- is data loss.
--
-- Expiry is judged against the show's end date wherever it is read, never
-- against today — the same rule health paperwork follows, for the same reason: a
-- card that lapses mid-show is the case staff need to chase, and comparing to
-- today calls it valid right up until it is too late.

BEGIN;

ALTER TABLE exhibitor_registrations
    ADD COLUMN IF NOT EXISTS expires_at DATE;

-- Give the APHA rows their expiry from the legacy column.
UPDATE exhibitor_registrations er
SET expires_at = e.apha_member_expiry
FROM exhibitors e, associations a
WHERE er.exhibitor_id = e.id
  AND er.association_id = a.id
  AND a.code = 'APHA'
  AND er.expires_at IS NULL
  AND e.apha_member_expiry IS NOT NULL;

-- And create the row outright where a number was only ever recorded the old way.
INSERT INTO exhibitor_registrations (exhibitor_id, association_id, member_number, expires_at)
SELECT e.id, a.id, btrim(e.apha_member_number), e.apha_member_expiry
FROM exhibitors e
CROSS JOIN associations a
WHERE a.code = 'APHA'
  AND e.apha_member_number IS NOT NULL
  AND btrim(e.apha_member_number) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM exhibitor_registrations er
      WHERE er.exhibitor_id = e.id AND er.association_id = a.id
  )
ON CONFLICT ON CONSTRAINT uq_exhibitor_registrations_exhibitor_association DO NOTHING;

COMMENT ON COLUMN exhibitor_registrations.expires_at IS
    'When this membership lapses. NULL means unknown, not current. Judged '
    'against the show''s end date wherever it is read, never against today.';

INSERT INTO _migrations (name) VALUES ('117_exhibitor_registration_expiry.sql')
ON CONFLICT DO NOTHING;

COMMIT;
