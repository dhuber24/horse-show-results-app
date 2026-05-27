ALTER TABLE show_judges DROP COLUMN IF EXISTS affiliation_id;

CREATE TABLE show_judge_affiliations (
    judge_id     UUID NOT NULL REFERENCES show_judges(id) ON DELETE CASCADE,
    show_type_id UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    PRIMARY KEY (judge_id, show_type_id)
);
