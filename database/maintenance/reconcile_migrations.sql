-- Reconcile the _migrations ledger with what the schema actually shows.
--
-- STATUS: run against production 2026-09-10. Nothing needed backfilling -- all
-- fifteen ledger rows 123-137 were present, and every Part D object was too.
-- Migrations 123-135 predate the 2026-09-08 dev/production branch split, so they
-- went to production through migrate.ps1, which writes the ledger row itself;
-- their missing self-recording INSERT never bit. 136 and 137 are the only two
-- ever hand-applied, and both self-record. This script is therefore INSURANCE,
-- not a repair: re-run Part A before any release that hand-applies a migration.
--
-- WHY THIS EXISTS
--
-- Migrations 123-133 carry no INSERT INTO _migrations of their own. 108 of the
-- 140 migrations do; that eleven-migration run does not. Production's schema is
-- now released by hand through Neon's SQL editor, which applies the SQL but
-- records nothing -- so a migration in that style, hand-applied, would leave
-- production with the schema change and no ledger row saying so.
--
-- That matters the first time migrate.ps1 -AllowProduction runs against
-- production: it would re-execute every unrecorded migration. They are written
-- idempotently (guarded DO blocks, IF NOT EXISTS, DROP CONSTRAINT IF EXISTS),
-- so a replay is very likely harmless -- but it destroys the one signal the
-- release procedure tells you to read, because an already-applied migration
-- then reports "applying:" instead of "skipped:".
--
-- HOW TO USE IT
--
-- Paste into Neon's SQL editor against the PRODUCTION branch. Part A is
-- read-only and safe to run at any time; read its output before running Part B.
--
-- There is no BEGIN/COMMIT wrapper and no multi-literal COMMENT, because Neon's
-- web console manages its own transaction and normalises whitespace -- which
-- collapses adjacent string literals onto one line and turns them into a syntax
-- error. Everything here is written to survive that.
--
-- WHAT IT WILL NOT DO
--
-- It never records a migration whose effect is not visible in the schema. A
-- ledger row claiming "applied" for something that was not applied is strictly
-- worse than a missing row: a missing row causes a harmless replay, a false row
-- causes the migration to be skipped forever. Every insert below is gated on
-- information_schema evidence, and anything failing its check is left alone and
-- shows up in Part C.


-- ============================================================
-- PART A (read-only): which ledger rows are missing?
-- ============================================================
-- Run this before Part B, and again after it as Part C -- it is the same query
-- both times, and the second run is how you confirm the work landed.
--
-- A row reading MISSING means the ledger has no record of that migration. It
-- does NOT mean the migration did not run: production schema is applied by hand
-- in Neon's SQL editor, which records nothing. Part B decides which of the two
-- it is, by checking the schema for each migration's actual effect.
--
-- Check applied_at on the rows that are recorded. If 123-133 all carry
-- timestamps within a few seconds of each other, you are looking at a database
-- where Part B has already run -- or at the dev branch. Confirm the branch
-- selector says production before running Part B.

SELECT
    expected.name,
    CASE WHEN m.name IS NULL THEN 'MISSING' ELSE 'recorded' END AS ledger,
    m.applied_at
FROM (VALUES
    ('123_show_entry_deadline.sql'),
    ('124_show_categories.sql'),
    ('125_per_judge_per_entry_fee_unit.sql'),
    ('126_show_entry_cancellation.sql'),
    ('127_show_bill_source.sql'),
    ('128_registration_wizard.sql'),
    ('129_classes_entered_by_qualification.sql'),
    ('130_show_fees_breed_association_only.sql'),
    ('131_drop_show_fees_breed_association_only.sql'),
    ('132_office_charge_becomes_a_fee.sql'),
    ('133_show_sanctioning_fee_unit.sql'),
    ('134_exhibitor_competition_cards.sql'),
    ('135_judge_role.sql'),
    ('136_show_registration_drafts.sql'),
    ('137_show_fee_classes.sql')
) AS expected(name)
LEFT JOIN _migrations m ON m.name = expected.name
ORDER BY expected.name;


-- ============================================================
-- PART B (writes): record what the schema proves is applied
-- ============================================================
-- Each statement inserts one ledger row only where the schema shows that
-- migration's effect. ON CONFLICT DO NOTHING makes every one safe to re-run.

-- 123: shows.entry_deadline added
INSERT INTO _migrations (name)
SELECT '123_show_entry_deadline.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'shows' AND column_name = 'entry_deadline')
ON CONFLICT DO NOTHING;

-- 124: the show_categories table, plus both columns it hangs off shows
INSERT INTO _migrations (name)
SELECT '124_show_categories.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'show_categories')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'shows' AND column_name = 'show_category_id')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'shows' AND column_name = 'offers_clinic')
ON CONFLICT DO NOTHING;

-- 125: adds per_judge_per_entry to the show_fees.unit CHECK list. No column to
-- look for, so the evidence is the constraint definition itself.
INSERT INTO _migrations (name)
SELECT '125_per_judge_per_entry_fee_unit.sql'
WHERE EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'show_fees_unit_check'
      AND pg_get_constraintdef(oid) LIKE '%per_judge_per_entry%'
)
ON CONFLICT DO NOTHING;

-- 126: the three cancellation columns on show_entries
INSERT INTO _migrations (name)
SELECT '126_show_entry_cancellation.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_entries' AND column_name = 'cancelled_at')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_entries' AND column_name = 'cancelled_by_user_id')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_entries' AND column_name = 'cancellation_reason')
ON CONFLICT DO NOTHING;

-- 127: the show_documents table and the shows.showbill_source column selecting it
INSERT INTO _migrations (name)
SELECT '127_show_bill_source.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'show_documents')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'shows' AND column_name = 'showbill_source')
ON CONFLICT DO NOTHING;

-- 128: three columns across three tables
INSERT INTO _migrations (name)
SELECT '128_registration_wizard.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_fees' AND column_name = 'min_quantity')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'exhibitor_horses' AND column_name = 'relationship_to_owner')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_entries' AND column_name = 'stall_request')
ON CONFLICT DO NOTHING;

-- 129: classes.entered_by_qualification added
INSERT INTO _migrations (name)
SELECT '129_classes_entered_by_qualification.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'classes' AND column_name = 'entered_by_qualification')
ON CONFLICT DO NOTHING;

-- 130 and 131 are a pair: 130 added show_fees.breed_association_only and 131
-- dropped it again. The column being ABSENT is the only observable end state,
-- and it is the same end state whether both ran or neither did -- so recording
-- both is safe, and so is recording neither (a replay applies 130 then 131 in
-- order, netting to nothing).
--
-- What must never happen is recording 131 WITHOUT 130: a later replay would
-- then add the column back and never drop it again. 131's insert is therefore
-- additionally gated on 130's row already existing, so the pair cannot come
-- apart no matter how many times this runs or in what order.
INSERT INTO _migrations (name)
SELECT '130_show_fees_breed_association_only.sql'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'show_fees' AND column_name = 'breed_association_only')
ON CONFLICT DO NOTHING;

INSERT INTO _migrations (name)
SELECT '131_drop_show_fees_breed_association_only.sql'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'show_fees' AND column_name = 'breed_association_only')
  AND EXISTS (SELECT 1 FROM _migrations
              WHERE name = '130_show_fees_breed_association_only.sql')
ON CONFLICT DO NOTHING;

-- 132: the office charge became an ordinary show_fees row, so both columns went
INSERT INTO _migrations (name)
SELECT '132_office_charge_becomes_a_fee.sql'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'shows' AND column_name = 'office_charge_cents')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'shows' AND column_name = 'office_charge_basis')
ON CONFLICT DO NOTHING;

-- 133: the rename that caused the outage, plus the fee_unit column beside it.
-- Both halves are required: the new name present AND the old name gone.
INSERT INTO _migrations (name)
SELECT '133_show_sanctioning_fee_unit.sql'
WHERE EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_sanctioning' AND column_name = 'fee_amount_cents')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'show_sanctioning' AND column_name = 'per_class_fee_cents')
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'show_sanctioning' AND column_name = 'fee_unit')
ON CONFLICT DO NOTHING;


-- ============================================================
-- PART C (read-only): re-run Part A
-- ============================================================
-- Same query as Part A. Nothing should still read MISSING. Anything that does
-- failed its evidence check, which means production genuinely does not have
-- that migration's effect and it needs applying. Do not insert the row by hand.


-- ============================================================
-- PART D (read-only): did create_all fake a table?
-- ============================================================
-- The one thing readiness cannot tell you. `create_all` builds a missing TABLE
-- from the models at boot, so a deploy that landed ahead of a CREATE TABLE
-- migration comes up green with every column present -- and none of the server
-- defaults, unique indexes or supporting indexes the migration also states.
--
-- These are exactly the objects create_all does not create. Every row should
-- read present. A missing one means that table was improvised by create_all and
-- its migration still needs running -- which is not a ledger problem and Part B
-- will not fix it.

SELECT 'show_fee_classes.id default (137)' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'show_fee_classes' AND column_name = 'id'
                           AND column_default IS NOT NULL)
            THEN 'present' ELSE 'MISSING' END AS state
UNION ALL SELECT 'show_fee_classes_fee_class_uniq (137)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE indexname = 'show_fee_classes_fee_class_uniq')
            THEN 'present' ELSE 'MISSING' END
UNION ALL SELECT 'show_fee_classes_class_idx (137)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE indexname = 'show_fee_classes_class_idx')
            THEN 'present' ELSE 'MISSING' END
UNION ALL SELECT 'show_registration_drafts.id default (136)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'show_registration_drafts' AND column_name = 'id'
                           AND column_default IS NOT NULL)
            THEN 'present' ELSE 'MISSING' END
UNION ALL SELECT 'show_registration_drafts_show_exhibitor_uniq (136)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE indexname = 'show_registration_drafts_show_exhibitor_uniq')
            THEN 'present' ELSE 'MISSING' END
UNION ALL SELECT 'show_registration_drafts_exhibitor_idx (136)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE indexname = 'show_registration_drafts_exhibitor_idx')
            THEN 'present' ELSE 'MISSING' END
UNION ALL SELECT 'show_documents table (127)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE indexname = 'show_documents_show_type_uniq')
            THEN 'present' ELSE 'MISSING' END
UNION ALL SELECT 'show_categories_type_code_uniq (124)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                         WHERE indexname = 'show_categories_type_code_uniq')
            THEN 'present' ELSE 'MISSING' END
ORDER BY object;
