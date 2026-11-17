-- 198: a stall line is a box, tie or tack stall.
--
-- Migration 194 gave a line priced per stall one `horse` kind for a box or a
-- tie stall, and left which to the line's own name. Shows price the two
-- differently (WSCA: box stalls by period, tie stalls $25), and the Lodging
-- step now prices each stall period's box, tie and tack stalls as three fixed
-- types rather than lines the office names, so the kind says which:
-- `box`, `tie`, `tack`, or `add_on` (priced per stall but not a stall, such as
-- the Early Move-In Pass). A box and a tie stall both stand a horse
-- (`stabling.HORSE_KINDS`).
--
-- `horse` was only ever written on dev (194 is not released): it becomes `tie`
-- where the line names a tie stall and `box` otherwise, as
-- `stabling.stall_kind_of` reads a line with no kind. The old CHECK goes first,
-- since it does not allow the new values. NULL is still read from the line.
--
-- Idempotent, and backward-compatible: production first.

BEGIN;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_stall_kind;

UPDATE show_fees
   SET stall_kind = CASE
         WHEN (coalesce(label, '') || ' ' || coalesce(code, '')) ~* '(^|[^a-z])tie([^a-z]|$)' THEN 'tie'
         ELSE 'box'
       END
 WHERE stall_kind = 'horse';

ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_stall_kind
    CHECK (stall_kind IS NULL OR stall_kind IN ('box', 'tie', 'tack', 'add_on'));

COMMENT ON COLUMN show_fees.stall_kind IS
    'On a per_stall line: box, tie, tack or add_on. NULL is read from the line (stabling.stall_kind_of).';

INSERT INTO _migrations (name) VALUES ('198_stall_types.sql')
ON CONFLICT DO NOTHING;

COMMIT;
