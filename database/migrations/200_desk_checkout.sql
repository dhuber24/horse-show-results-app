-- 200: an exhibitor checking out at the desk.
--
-- When an exhibitor leaves, the show office checks them out: looks the stalls
-- over, charges whatever is still owed -- a stall left uncleaned, a lost stall
-- card (each an office charge, `show_account_adjustments`, migration 197) --
-- settles the balance, and marks them out. These say when and by whom, so the
-- desk can see who has gone. A record, never a gate: GaitDesk refuses nothing
-- over it, and a balance still owing is shown, not enforced.
--
-- `checked_out_by_name` is kept beside the id, as on a payment, so the record
-- still reads after the staff account is gone. Undoing a checkout clears all
-- three.
--
-- Nullable columns: backward-compatible, production first.

BEGIN;

ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;
ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS checked_out_by UUID;
ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS checked_out_by_name TEXT;

ALTER TABLE show_entries DROP CONSTRAINT IF EXISTS fk_show_entries_checked_out_by;
ALTER TABLE show_entries ADD CONSTRAINT fk_show_entries_checked_out_by
    FOREIGN KEY (checked_out_by) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN show_entries.checked_out_at IS
    'When the show office checked this exhibitor out at the desk. NULL until then, and after an undo.';
COMMENT ON COLUMN show_entries.checked_out_by_name IS
    'Who checked them out, as named when they did.';

INSERT INTO _migrations (name) VALUES ('200_desk_checkout.sql')
ON CONFLICT DO NOTHING;

COMMIT;
