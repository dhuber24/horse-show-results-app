-- Migration 060: Fee Schedule per show.
--
-- New `show_fees` table holds non-class-entry fees a show charges exhibitors:
-- stall, tack stall, bedding, RV / dry camping, drug test, late entry,
-- post-entry, cross-entry, stall cleanout, association surcharges, etc.
--
-- Per-class entry fees stay on `classes.entry_fee_cents` and the office
-- charge stays on `shows.office_charge_cents`. The Fee Schedule UI is the
-- canonical surface to edit ALL of them, but storage is unchanged so
-- show_registration.py, side pots, and exhibitor checkout keep working
-- without modification.
--
-- `unit` is enforced by a check constraint matching the application enum.
-- `code` is a non-unique slug for templating / categorization; many
-- secretaries will add multiple rows of the same code (e.g., box stall
-- vs. tie stall both `code = 'stall'`).

CREATE TABLE show_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    unit TEXT NOT NULL CHECK (unit IN (
        'flat',
        'per_entry',
        'per_horse',
        'per_class_per_horse',
        'per_night',
        'per_stall',
        'per_bag',
        'percent_of_entry'
    )),
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX show_fees_show_id_idx ON show_fees (show_id, sort_order);

INSERT INTO _migrations (name) VALUES ('060_show_fees.sql');
