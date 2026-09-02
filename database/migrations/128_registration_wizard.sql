-- 128: what the registration wizard has to be able to record.
--
-- Three columns, three questions the exhibitor is now asked once instead of
-- either never or on every class.
--
-- 1. `show_fees.min_quantity` -- the floor under a reservable line. A show that
--    bans outside shavings is telling the exhibitor to buy bedding here, and
--    "buy some" without a number is a stall bedded with two bags at a show that
--    requires four. The floor lives on the fee rather than on `shows` because
--    it is a property of the line being sold: a show may require four bags of
--    shavings and no particular number of stalls, and a second show may sell
--    two kinds of bedding with different minimums. Zero -- the default and
--    every existing row -- means no floor, which is what every show had before
--    this and what most will go on having.
--
--    Only meaningful on a reservable unit (per_stall / per_bag / per_night /
--    per_day / per_show). Nothing else has a quantity for it to bound, which is
--    the same rule that governs where an early rate may be set, and it is
--    enforced in the router beside that one rather than by a CHECK -- the unit
--    families live in billing.py, not in the schema.
--
-- 2. `show_entries.stall_request` -- "put me next to Bob Smith's barn". Kept
--    apart from `registration_notes` because the office reads the two at
--    different moments: stalling requests are read once, all together, while
--    the stall chart is being drawn, and "arriving late Friday" is read at the
--    gate. Both in one box meant whoever drew the chart had to reread every
--    exhibitor's arrival plans to find the three sentences that mattered.
--
-- 3. `exhibitor_horses.relationship_to_owner` -- how this exhibitor is entitled
--    to show this horse (APHA AM-300.E, YP-015). It was asked on the entry
--    form, per class, from a list of twenty-five options -- so somebody
--    entering eight classes on their own horse answered "Self" eight times and
--    could answer differently on the eighth. It is a fact about the person and
--    the horse, not about the class, so it is stored once against the pair and
--    copied onto every entry.
--
--    On `exhibitor_horses` rather than on `horses`: two people may show the
--    same horse and their relationships to its owner are different answers.
--    A horse reaches a profile either through this table or through
--    `horses.created_by_exhibitor_id`, so the endpoint that sets the
--    relationship upserts the link row -- which asserts nothing new, since the
--    horse is already on that profile.
ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS min_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_min_quantity;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_min_quantity
    CHECK (min_quantity >= 0);

ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS stall_request TEXT;

ALTER TABLE exhibitor_horses ADD COLUMN IF NOT EXISTS relationship_to_owner TEXT;

COMMENT ON COLUMN show_fees.min_quantity IS
    'Fewest units an exhibitor may reserve of this line once they reserve any. 0 = no floor. Only meaningful on a reservable unit; enforced in the router, where the unit families are known.';
COMMENT ON COLUMN show_entries.stall_request IS
    'Stabling requests -- "next to the Smith barn". Separate from registration_notes because the stall chart is drawn from these alone.';
COMMENT ON COLUMN exhibitor_horses.relationship_to_owner IS
    'How this exhibitor is entitled to show this horse (APHA AM-300.E / YP-015). Asked once per horse and copied onto every entry, never asked per class.';
