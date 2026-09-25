-- 145: what one show's registration holds about the exhibitor, apart from
-- their profile.
--
-- The registration wizard's first three steps -- your details, your
-- memberships, your horses -- wrote straight to the exhibitor's own profile.
-- So taking a horse off one show's registration took it off the profile, and
-- correcting a phone number for one weekend rewrote it everywhere. The profile
-- is the exhibitor's; a registration is one show's copy of it. From here:
--
-- * **The profile prepopulates the registration and is never written by it.**
-- * **Each step follows the profile until something in that step is
--   changed.** A registration that never touched its horses keeps listing
--   whatever is on the profile; the first add, remove or relationship answer
--   copies the profile's horses into `show_registration_horses` and the step
--   reads its own rows from then on. Same for the details and the
--   memberships. The `*_saved_at` column is what says which: NULL follows the
--   profile, a timestamp means the rows here are the answer.
--
-- Why per step rather than one copy taken when the form opens: a registration
-- nobody edited keeps up with a profile somebody corrected afterwards, and the
-- thousands of registrations made before this table existed need no backfill --
-- every one of them simply follows the profile, which is what they always did.
--
-- Keyed on (show, exhibitor) rather than on `show_entries`, because the first
-- three steps happen before sign-up creates that row -- and a `show_entries`
-- shell row is the office's roster, which somebody who only opened the form
-- does not belong on (migration 136).
--
-- Additive only: three new tables and nothing renamed, so this is safe to
-- apply before the release that reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS show_registration_profiles (
    id UUID PRIMARY KEY,
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    details_saved_at TIMESTAMPTZ,
    date_of_birth DATE,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    parent_guardian_name TEXT,
    parent_guardian_phone TEXT,
    memberships_saved_at TIMESTAMPTZ,
    horses_saved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS show_registration_horses (
    id UUID PRIMARY KEY,
    registration_id UUID NOT NULL
        REFERENCES show_registration_profiles(id) ON DELETE CASCADE,
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    relationship_to_owner TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS show_registration_memberships (
    id UUID PRIMARY KEY,
    registration_id UUID NOT NULL
        REFERENCES show_registration_profiles(id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    member_number TEXT NOT NULL,
    expires_at DATE,
    created_at TIMESTAMPTZ NOT NULL
);

-- Stated apart from the CREATE TABLEs, and every insert supplies its own id:
-- backend startup runs `create_all` and may have built these tables from the
-- models before this migration lands, in which case `CREATE TABLE IF NOT
-- EXISTS` skips and leaves no server defaults at all (migration 114).
ALTER TABLE show_registration_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_registration_profiles ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE show_registration_horses ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_registration_horses ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE show_registration_memberships ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_registration_memberships ALTER COLUMN created_at SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS show_registration_profiles_show_exhibitor_uniq
    ON show_registration_profiles (show_id, exhibitor_id);
CREATE INDEX IF NOT EXISTS show_registration_profiles_exhibitor_idx
    ON show_registration_profiles (exhibitor_id);
CREATE UNIQUE INDEX IF NOT EXISTS show_registration_horses_registration_horse_uniq
    ON show_registration_horses (registration_id, horse_id);
CREATE UNIQUE INDEX IF NOT EXISTS show_registration_memberships_registration_association_uniq
    ON show_registration_memberships (registration_id, association_id);

COMMENT ON TABLE show_registration_profiles IS
    'One show''s copy of an exhibitor''s profile. Prepopulated from the profile '
    'and never written back to it. Each step follows the profile until its '
    '*_saved_at is set.';
COMMENT ON COLUMN show_registration_profiles.details_saved_at IS
    'NULL: this show reads the contact details, date of birth and emergency '
    'contact off the profile. Set: the columns on this row are the answer.';
COMMENT ON COLUMN show_registration_profiles.memberships_saved_at IS
    'NULL: this show reads exhibitor_registrations. Set: '
    'show_registration_memberships is the answer, even when it is empty.';
COMMENT ON COLUMN show_registration_profiles.horses_saved_at IS
    'NULL: the horses on the profile are the horses on this registration. Set: '
    'show_registration_horses is the list, even when it is empty.';
COMMENT ON TABLE show_registration_horses IS
    'The horses on one show''s registration, once it stopped following the '
    'profile. Removing a row here never touches the profile.';
COMMENT ON COLUMN show_registration_horses.relationship_to_owner IS
    'How the exhibitor is entitled to show this horse at this show (APHA '
    'AM-300.E, YP-015). Copied from exhibitor_horses when the list was taken.';
COMMENT ON TABLE show_registration_memberships IS
    'The association memberships on one show''s registration, once it stopped '
    'following the profile.';

INSERT INTO _migrations (name) VALUES ('145_show_registration_profiles.sql')
ON CONFLICT DO NOTHING;

COMMIT;
