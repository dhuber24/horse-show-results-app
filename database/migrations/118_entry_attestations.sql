-- Migration 118: what the entrant declared, and when.
--
-- APHA's Novice divisions are gated on points and money, not on anything the
-- app holds: Novice Amateur eligibility is decided per category at the time
-- status is applied for (AM-205), and Novice Youth Boxing caps fence-work
-- earnings at $750 (YP-255.A.1). The rule book is explicit about who answers
-- for it — "the responsibility for eligibility lies with the exhibitor", and
-- "the burden of proof lies with the person who protests".
--
-- So the app must not try to verify this. It has no points database and never
-- will. What it can do is record the declaration: who made it, when, and the
-- exact words they agreed to.
--
-- `statement` is stored rather than looked up, for the same reason a signed
-- waiver keeps its own text: the wording will change when APHA revises the
-- limits, and a row that pointed at the current wording would silently restate
-- what somebody agreed to two seasons ago. It is written by the backend from
-- `rules/apha.py`, never accepted from the client — there is nothing on file to
-- derive it from, but there is also no reason to let a caller compose the
-- sentence it is attesting to.
--
-- `attested_by_name` is a denormalized snapshot, like coggins_override_audit's,
-- so the row stays readable after the user record goes.
--
-- One row per (entry, kind): an entry is declared once. Re-declaring is an
-- update to the row that is already there, not a second fact.

BEGIN;

CREATE TABLE IF NOT EXISTS entry_attestations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id            UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL,
    statement           TEXT NOT NULL,
    attested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    attested_by_name    TEXT,
    attested_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stated separately: `create_all` may have made the table from the model first,
-- in which case CREATE TABLE IF NOT EXISTS did nothing and none of the SQL-level
-- defaults or constraints above are actually present. Same trap as 114 and 116.
ALTER TABLE entry_attestations
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE entry_attestations
    ALTER COLUMN attested_at SET DEFAULT now();

ALTER TABLE entry_attestations
    DROP CONSTRAINT IF EXISTS ck_entry_attestations_kind;

ALTER TABLE entry_attestations
    ADD CONSTRAINT ck_entry_attestations_kind
    CHECK (kind IN ('novice_eligibility'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_attestations_entry_kind
    ON entry_attestations (entry_id, kind);

CREATE INDEX IF NOT EXISTS ix_entry_attestations_entry_id
    ON entry_attestations (entry_id);

COMMENT ON TABLE entry_attestations IS
    'What the entrant declared about an entry, and when. Recorded, never '
    'verified: APHA Novice eligibility turns on points and earnings the app '
    'does not hold, and the rule book puts the responsibility on the exhibitor '
    'and the burden of proof on whoever protests.';

COMMENT ON COLUMN entry_attestations.statement IS
    'The exact words agreed to, stored rather than looked up — the wording '
    'changes when APHA revises its limits, and a pointer would restate what '
    'somebody agreed to two seasons ago. Written by the backend, never taken '
    'from the client.';

INSERT INTO _migrations (name) VALUES ('118_entry_attestations.sql')
ON CONFLICT DO NOTHING;

COMMIT;
