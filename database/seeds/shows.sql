-- Bulk-add shows.
-- show_type_id is looked up by code (APHA / AQHA / OPEN).
-- venue_id is looked up by venue name; leave NULL if venue row is absent.

INSERT INTO shows (name, venue, venue_id, show_type_id, start_date, end_date, status)
VALUES
    -- ('Spring Classic',  'Main Arena', (SELECT id FROM venues WHERE name = 'Main Arena'), (SELECT id FROM show_types WHERE code = 'APHA'), '2026-05-01', '2026-05-03', 'PUBLISHED'),
    -- ('Summer Open',     'North Barn', (SELECT id FROM venues WHERE name = 'North Barn'), (SELECT id FROM show_types WHERE code = 'OPEN'), '2026-07-10', '2026-07-12', 'DRAFT'),
    (NULL, NULL, NULL, NULL, NULL, NULL, NULL) -- placeholder: remove this line before running
;
