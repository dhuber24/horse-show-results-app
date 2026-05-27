CREATE TABLE show_judges (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id         UUID        NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    first_name      TEXT        NOT NULL,
    last_name       TEXT        NOT NULL,
    email           TEXT,
    phone           TEXT,
    affiliation_id  UUID        REFERENCES show_types(id) ON DELETE SET NULL,
    sort_order      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX show_judges_show_id_idx ON show_judges(show_id);
