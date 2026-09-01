-- 126: cancelling a show registration.
--
-- An exhibitor who is not coming had no way to say so. `withdraw_entry` drops
-- one class and the desk's `remove_exhibitor_from_roster` refuses outright once
-- `registered_at` is set, so the only exit from a completed sign-up was to drop
-- every class one at a time and leave a stall booked against a show the horse
-- would never reach.
--
-- Marked rather than deleted, for the reason a refund is a negative
-- `show_payments` row and never an edit to the original: `show_entries`
-- cascades to payments, so deleting the row to cancel a registration would take
-- a recorded payment with it. The row survives, its class entries and
-- reservations do not, and what is left is a bill of nothing against whatever
-- was already paid -- which is a credit, and exactly what the office needs to
-- see in order to refund it.
--
-- `cancelled_by_user_id` is who pressed the button, not who was cancelled. The
-- window rule (an exhibitor may cancel up to 14 days before the show; inside
-- that only staff may) is enforced in the router, not here -- a CHECK could not
-- see who the caller was.
ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN show_entries.cancelled_at IS
    'Set when the registration is cancelled. On the roster means registered_at IS NOT NULL AND cancelled_at IS NULL. Re-signing up clears it.';
COMMENT ON COLUMN show_entries.cancelled_by_user_id IS
    'Who cancelled -- the exhibitor themselves outside the 14-day window, or the show staff member who did it inside it.';
COMMENT ON COLUMN show_entries.cancellation_reason IS
    'Free text, optional. What the exhibitor or the office said about why.';
