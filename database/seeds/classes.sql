-- Bulk-add classes. show_id is looked up by show name.

INSERT INTO classes (show_id, class_number, class_name, class_date, status)
VALUES
    -- ((SELECT id FROM shows WHERE name = 'Spring Classic'), '101', 'Ranch Pleasure Open',   '2026-05-01', 'OPEN'),
    -- ((SELECT id FROM shows WHERE name = 'Spring Classic'), '102', 'Western Pleasure Amateur','2026-05-02', 'OPEN'),
    (NULL, NULL, NULL, NULL, NULL) -- placeholder: remove this line before running
;
