-- 209: a stall inspection before checkout, and the fee the office may charge.
--
-- Many shows look every stall over before an exhibitor leaves -- stripped,
-- cleaned, nothing broken -- and some charge for it. The Lodging step now asks
-- whether this show requires that (`stall_inspection_required`), and when it
-- does, offers an optional fee (`stall_inspection_fee_cents`; NULL is no fee).
--
-- At the desk the exhibitor's Bill & checkout then carries one box: ticked, the
-- fee goes on their bill; unticked, it comes off. That charge is an office
-- charge like any other (`show_account_adjustments`, migration 197) -- on the
-- bill everywhere, in the total and the balance -- tagged `kind =
-- 'stall_inspection'` so the box knows which line is its own. At most one per
-- exhibitor, so a double click cannot bill it twice. Its amount is the fee as
-- it stood when the box was ticked; a fee changed later leaves charges already
-- made alone, as a repriced stall leaves nothing already billed.
--
-- A record and a charge, never a gate: checking out still refuses nothing.
--
-- Defaulted and nullable columns: backward-compatible, production first.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS stall_inspection_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS stall_inspection_fee_cents INTEGER;
ALTER TABLE shows DROP CONSTRAINT IF EXISTS ck_shows_stall_inspection_fee;
ALTER TABLE shows ADD CONSTRAINT ck_shows_stall_inspection_fee
    CHECK (stall_inspection_fee_cents IS NULL OR stall_inspection_fee_cents BETWEEN 1 AND 10000000);

COMMENT ON COLUMN shows.stall_inspection_required IS
    'The office inspects each exhibitor''s stalls before they check out (migration 209). Shown at the desk''s checkout; never a gate.';
COMMENT ON COLUMN shows.stall_inspection_fee_cents IS
    'What the desk charges for the stall inspection when it ticks the box at checkout (migration 209). NULL is no fee.';

ALTER TABLE show_account_adjustments ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE show_account_adjustments DROP CONSTRAINT IF EXISTS ck_show_account_adjustments_kind;
ALTER TABLE show_account_adjustments ADD CONSTRAINT ck_show_account_adjustments_kind
    CHECK (kind IS NULL OR kind IN ('stall_inspection'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_show_account_adjustments_stall_inspection
    ON show_account_adjustments (show_entry_id)
    WHERE kind = 'stall_inspection';

COMMENT ON COLUMN show_account_adjustments.kind IS
    'What made this charge, when it was not typed: ''stall_inspection'' is the checkout box (migration 209). NULL is a line the office typed.';

INSERT INTO _migrations (name) VALUES ('209_stall_inspection_fee.sql')
ON CONFLICT DO NOTHING;

COMMIT;
