-- 189: a show set up from its show bill no longer waits on an Accept per doubt.
--
-- Migration 187 made every doubt about a show bill's read a row of
-- show_bill_checks, and a show could not leave DRAFT while one was open. From
-- this release the show is filled in as far as the bill allows and every doubt
-- is a line of its office notes instead (`backend/showbill_draft.py`): the
-- office reads them as it walks the setup steps and changes what looks wrong,
-- with nothing to press Accept on.
--
-- This copies every check nobody accepted onto the end of its show's office
-- notes, in the order the steps listed them, so a show part-way through the old
-- review keeps what was still to look at. A show whose notes already carry the
-- heading is skipped, so running this twice adds nothing. Held to the 20,000
-- characters `ShowUpdate` takes for the notes.
--
-- Data only. The table stays: the running release maps it until the new code
-- is out, and it is dropped in a later release once no build does. A check
-- written by the old code between this and the new code's deploy is not
-- copied -- it would take a show created from a bill in those few minutes.
-- Goes to production before the code.

BEGIN;

WITH left_to_check AS (
    SELECT show_id,
           string_agg('- ' || message, E'\n' ORDER BY sort_order) AS lines
    FROM show_bill_checks
    WHERE accepted_at IS NULL
    GROUP BY show_id
)
UPDATE shows s
SET office_notes = left(
    concat_ws(
        E'\n\n',
        nullif(btrim(s.office_notes), ''),
        'Left to check from the show bill:' || E'\n' || l.lines
    ),
    20000
)
FROM left_to_check l
WHERE s.id = l.show_id
  AND coalesce(s.office_notes, '') NOT LIKE '%Left to check from the show bill:%';

INSERT INTO _migrations (name) VALUES ('189_show_bill_checks_to_office_notes.sql')
ON CONFLICT DO NOTHING;

COMMIT;
