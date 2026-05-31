-- Migration 072: Sanctioned associations + show setup wizard fields
--
-- Sanctioned associations (NSBA, WSCA, ...) are distinct from breed
-- associations (`show_types` — APHA, AQHA, ApHC, etc.). A show is created
-- under one breed `show_type`, but may also be sanctioned by zero or more
-- sanctioning bodies for some or all of its classes.
--
-- We store sanctioning bodies in their own registry so they can be managed
-- separately from breed types (different admin surface, different fee
-- semantics, different rules surface). Users can request new sanctioning
-- bodies inline from the wizard; requests land in a pending queue for
-- admin review.
--
-- Per-show sanctioning is a join table with a `per_class_fee_cents`
-- amount that the secretary collects on top of the standard class fee
-- whenever a class is flagged as eligible for that sanction. Per-class
-- eligibility flagging is a follow-up; this migration just establishes
-- show-level sanctioning + the fee amount.
--
-- Two new columns on `shows`:
--   * office_charge_basis: whether the office charge is taken once per
--     back number (i.e. per exhibitor / family) or once per horse. The
--     amount itself stays in `shows.office_charge_cents` (migration 060).
--   * shavings_ban_outside: policy flag surfaced to exhibitors on the
--     self-registration screen. Independent of any shavings fee row in
--     `show_fees`.

BEGIN;

CREATE TABLE sanctioned_associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sanctioned_association_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_name TEXT NOT NULL,
    requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    show_id UUID REFERENCES shows(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_association_id UUID REFERENCES sanctioned_associations(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sanctioned_association_requests_status_idx
    ON sanctioned_association_requests (status, created_at);

CREATE TABLE show_sanctioning (
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    sanctioned_association_id UUID NOT NULL REFERENCES sanctioned_associations(id) ON DELETE CASCADE,
    per_class_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (per_class_fee_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (show_id, sanctioned_association_id)
);

ALTER TABLE shows
    ADD COLUMN office_charge_basis TEXT NOT NULL DEFAULT 'per_back_number'
        CHECK (office_charge_basis IN ('per_back_number', 'per_horse')),
    ADD COLUMN shavings_ban_outside BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO sanctioned_associations (code, name) VALUES
    ('NSBA', 'National Snaffle Bit Association'),
    ('WSCA', 'Western Saddle Club Association')
ON CONFLICT (code) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('072_sanctioned_associations.sql')
ON CONFLICT DO NOTHING;

COMMIT;
