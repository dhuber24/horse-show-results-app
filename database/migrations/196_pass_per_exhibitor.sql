-- 196: an Early Move-In Pass priced per exhibitor, not only per stall.
--
-- The Lodging step now offers an early move-in for each stall period, and a
-- show prices it one of two ways: per stall (somebody moving four stalls in
-- early buys four passes) or once per exhibitor (one pass, however many
-- stalls). `show_fees.one_per_exhibitor` is the second: the exhibitor books it
-- at most once, the sign-up form shows a tick box instead of a count, and the
-- price prints "per exhibitor". Billing is unchanged -- rate x quantity, and the
-- quantity is 0 or 1.
--
-- Read on an add-on priced per stall only (`stabling.stall_kind_of` = add_on),
-- which is what a pass is. A pass is still found by its code: `early_move_in`
-- for the whole show, `early_move_in_<period>` for a stall period's own.
--
-- A defaulted column: backward-compatible, so this goes to production before
-- the code.

BEGIN;

ALTER TABLE show_fees
    ADD COLUMN IF NOT EXISTS one_per_exhibitor BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN show_fees.one_per_exhibitor IS
    'An add-on such as the Early Move-In Pass booked at most once per exhibitor and priced per exhibitor, not per stall.';

INSERT INTO _migrations (name) VALUES ('196_pass_per_exhibitor.sql')
ON CONFLICT DO NOTHING;

COMMIT;
