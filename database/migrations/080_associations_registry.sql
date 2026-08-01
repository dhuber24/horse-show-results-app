-- Migration 080: split associations out of show_types into their own registry.
--
-- `show_types` had been doing two unrelated jobs at once:
--
--   1. Show configuration — "what kind of horse show is this?", which drives
--      eligibility, the standard class catalogs, and class codes.
--   2. Affiliation — "which body is this horse/exhibitor/trainer registered
--      with?", which is a property of the horse or person, not of any show.
--
-- Those are related but different, and conflating them forced club bodies
-- (NSBA, WSCA) to masquerade as show types so their membership numbers had
-- somewhere to live. They were then duplicated *again* in
-- `sanctioned_associations` for per-show sanctioning fees.
--
-- After this migration:
--
--   associations  — the single registry of bodies, typed 'breed' or 'club'.
--                   Everything that stores a membership/registration number
--                   points here. Also the source for per-show club sanctioning.
--   show_types    — show configuration only: breed-based show types plus OPEN.
--                   NSBA/WSCA are removed; an NSBA-sanctioned open show is now
--                   an OPEN show with NSBA club sanctioning.
--
-- OPEN deliberately has no `associations` row: "Open" is the *absence* of a
-- breed association, not a body anyone holds a membership with.
--
-- Safe to run against current data: 0 shows use NSBA/WSCA, 0 standard-catalog
-- rows reference them, and the affiliation tables hold a handful of rows.

BEGIN;

-- ── 1. The registry ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    association_type TEXT NOT NULL CHECK (association_type IN ('breed', 'club')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_associations_type ON associations (association_type);

-- Breed bodies: every show_type except OPEN and the two clubs.
INSERT INTO associations (code, name, association_type)
SELECT code, name, 'breed'
FROM show_types
WHERE code NOT IN ('OPEN', 'NSBA', 'WSCA')
ON CONFLICT (code) DO NOTHING;

-- Club bodies: prefer the sanctioned_associations spelling since that registry
-- was purpose-built for them, then backfill any club still only in show_types.
INSERT INTO associations (code, name, association_type, is_active)
SELECT code, name, 'club', is_active
FROM sanctioned_associations
ON CONFLICT (code) DO NOTHING;

INSERT INTO associations (code, name, association_type)
SELECT code, name, 'club'
FROM show_types
WHERE code IN ('NSBA', 'WSCA')
ON CONFLICT (code) DO NOTHING;

-- ── 2. Affiliation tables move to associations ────────────────────────────────
-- Each follows the same shape: add the column, backfill by matching code, make
-- it NOT NULL (where the old column was), then drop the show_types link.

-- horse_registrations
ALTER TABLE horse_registrations
    ADD COLUMN IF NOT EXISTS association_id UUID REFERENCES associations(id) ON DELETE CASCADE;

UPDATE horse_registrations hr
SET association_id = a.id
FROM show_types st
JOIN associations a ON a.code = st.code
WHERE st.id = hr.show_type_id AND hr.association_id IS NULL;

DELETE FROM horse_registrations WHERE association_id IS NULL;

ALTER TABLE horse_registrations ALTER COLUMN association_id SET NOT NULL;
ALTER TABLE horse_registrations DROP CONSTRAINT IF EXISTS horse_registrations_horse_id_show_type_id_key;
ALTER TABLE horse_registrations DROP CONSTRAINT IF EXISTS uq_horse_registrations_show_type_number;
ALTER TABLE horse_registrations DROP COLUMN IF EXISTS show_type_id;
ALTER TABLE horse_registrations
    ADD CONSTRAINT uq_horse_registrations_horse_association UNIQUE (horse_id, association_id);
ALTER TABLE horse_registrations
    ADD CONSTRAINT uq_horse_registrations_association_number UNIQUE (association_id, registration_number);

-- exhibitor_registrations
ALTER TABLE exhibitor_registrations
    ADD COLUMN IF NOT EXISTS association_id UUID REFERENCES associations(id) ON DELETE CASCADE;

UPDATE exhibitor_registrations er
SET association_id = a.id
FROM show_types st
JOIN associations a ON a.code = st.code
WHERE st.id = er.show_type_id AND er.association_id IS NULL;

DELETE FROM exhibitor_registrations WHERE association_id IS NULL;

ALTER TABLE exhibitor_registrations ALTER COLUMN association_id SET NOT NULL;
ALTER TABLE exhibitor_registrations DROP CONSTRAINT IF EXISTS exhibitor_registrations_exhibitor_id_show_type_id_key;
ALTER TABLE exhibitor_registrations DROP COLUMN IF EXISTS show_type_id;
ALTER TABLE exhibitor_registrations
    ADD CONSTRAINT uq_exhibitor_registrations_exhibitor_association UNIQUE (exhibitor_id, association_id);

-- trainer_registrations
ALTER TABLE trainer_registrations
    ADD COLUMN IF NOT EXISTS association_id UUID REFERENCES associations(id) ON DELETE CASCADE;

UPDATE trainer_registrations tr
SET association_id = a.id
FROM show_types st
JOIN associations a ON a.code = st.code
WHERE st.id = tr.show_type_id AND tr.association_id IS NULL;

DELETE FROM trainer_registrations WHERE association_id IS NULL;

ALTER TABLE trainer_registrations ALTER COLUMN association_id SET NOT NULL;
ALTER TABLE trainer_registrations DROP CONSTRAINT IF EXISTS trainer_registrations_trainer_id_show_type_id_key;
ALTER TABLE trainer_registrations DROP COLUMN IF EXISTS show_type_id;
ALTER TABLE trainer_registrations
    ADD CONSTRAINT uq_trainer_registrations_trainer_association UNIQUE (trainer_id, association_id);

-- exhibitor_documents (nullable: a document need not be association-tagged)
ALTER TABLE exhibitor_documents
    ADD COLUMN IF NOT EXISTS association_id UUID REFERENCES associations(id) ON DELETE SET NULL;

UPDATE exhibitor_documents ed
SET association_id = a.id
FROM show_types st
JOIN associations a ON a.code = st.code
WHERE st.id = ed.show_type_id AND ed.association_id IS NULL;

ALTER TABLE exhibitor_documents DROP COLUMN IF EXISTS show_type_id;

-- show_secretary_certifications
ALTER TABLE show_secretary_certifications
    ADD COLUMN IF NOT EXISTS association_id UUID REFERENCES associations(id) ON DELETE CASCADE;

UPDATE show_secretary_certifications sc
SET association_id = a.id
FROM show_types st
JOIN associations a ON a.code = st.code
WHERE st.id = sc.show_type_id AND sc.association_id IS NULL;

DELETE FROM show_secretary_certifications WHERE association_id IS NULL;

ALTER TABLE show_secretary_certifications ALTER COLUMN association_id SET NOT NULL;
ALTER TABLE show_secretary_certifications DROP CONSTRAINT IF EXISTS show_secretary_certifications_user_id_show_type_id_key;
ALTER TABLE show_secretary_certifications DROP COLUMN IF EXISTS show_type_id;
ALTER TABLE show_secretary_certifications
    ADD CONSTRAINT uq_secretary_certifications_user_association UNIQUE (user_id, association_id);

-- ── 3. Per-show club sanctioning reads from the same registry ─────────────────

ALTER TABLE show_sanctioning
    ADD COLUMN IF NOT EXISTS association_id UUID REFERENCES associations(id) ON DELETE CASCADE;

UPDATE show_sanctioning ss
SET association_id = a.id
FROM sanctioned_associations sa
JOIN associations a ON a.code = sa.code
WHERE sa.id = ss.sanctioned_association_id AND ss.association_id IS NULL;

DELETE FROM show_sanctioning WHERE association_id IS NULL;

ALTER TABLE show_sanctioning DROP CONSTRAINT IF EXISTS show_sanctioning_pkey;
ALTER TABLE show_sanctioning DROP COLUMN IF EXISTS sanctioned_association_id;
ALTER TABLE show_sanctioning ALTER COLUMN association_id SET NOT NULL;
ALTER TABLE show_sanctioning ADD PRIMARY KEY (show_id, association_id);

ALTER TABLE sanctioned_association_requests
    ADD COLUMN IF NOT EXISTS approved_association_ref_id UUID REFERENCES associations(id) ON DELETE SET NULL;

UPDATE sanctioned_association_requests r
SET approved_association_ref_id = a.id
FROM sanctioned_associations sa
JOIN associations a ON a.code = sa.code
WHERE sa.id = r.approved_association_id AND r.approved_association_ref_id IS NULL;

ALTER TABLE sanctioned_association_requests DROP COLUMN IF EXISTS approved_association_id;
ALTER TABLE sanctioned_association_requests
    RENAME COLUMN approved_association_ref_id TO approved_association_id;

DROP TABLE IF EXISTS sanctioned_associations;

-- ── 4. show_types keeps show configuration only ──────────────────────────────
-- Clubs are no longer a kind of show. An NSBA-sanctioned open show is an OPEN
-- show carrying NSBA club sanctioning.

DELETE FROM show_types WHERE code IN ('NSBA', 'WSCA');

INSERT INTO _migrations (name) VALUES ('080_associations_registry.sql')
ON CONFLICT DO NOTHING;

COMMIT;
