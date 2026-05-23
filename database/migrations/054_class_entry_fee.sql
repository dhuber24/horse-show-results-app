-- Migration 054: Per-class entry fee for exhibitor self-registration fee preview.
--
-- Exhibitors can now self-register for PUBLISHED shows and select which classes to
-- enter. The registration form displays a fee summary computed from this column.
-- No payment is collected by the app; the fee is informational and is settled
-- between the exhibitor and the show secretary outside the system.

ALTER TABLE classes
    ADD COLUMN entry_fee_cents INTEGER NOT NULL DEFAULT 0
        CHECK (entry_fee_cents >= 0);

INSERT INTO _migrations (name) VALUES ('054_class_entry_fee.sql');
