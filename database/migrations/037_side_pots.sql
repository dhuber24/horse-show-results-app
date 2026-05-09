-- Migration 037: Side pots (divisional jackpots)
--   Side pots are optional money pools that span multiple classes within a
--   show. An exhibitor opts in at the show_entry (back number) level and pays
--   a flat fee; the pot ranks all opt-ins by combined score across the
--   bundled classes and pays out per a producer-configurable schedule.
--
--   Tables:
--     side_pots          — pot definition: scoring + payout config
--     side_pot_classes   — which classes feed the pot
--     side_pot_entries   — back-number opt-ins (with paid flag)
--     side_pot_payouts   — frozen ranking + payout, written on "settle"
--
--   Notes:
--     * scoring_method = 'sum_scores' is only valid when every bundled
--       class is score_type IN ('pattern','time'). Validated at app layer.
--     * eligibility_rule = 'all_classes' (default) requires the opted-in
--       back number to have a result in every bundled class to be ranked.
--     * payout_schedule is JSONB keyed by entry-count band, e.g.:
--         {"1-3":[100], "4-7":[70,30], "8-15":[60,30,10], "16+":[40,25,15,12,8]}
--       The producer can override per pot. Validated at app layer.
--     * place may repeat in side_pot_payouts (true ties split the payout).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS side_pots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id           UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT,
    entry_fee_cents   INTEGER NOT NULL DEFAULT 1000,
    payback_percent   INTEGER NOT NULL DEFAULT 100,
    scoring_method    TEXT NOT NULL DEFAULT 'sum_placings',
    eligibility_rule  TEXT NOT NULL DEFAULT 'all_classes',
    payout_schedule   JSONB NOT NULL,
    status            TEXT NOT NULL DEFAULT 'open',
    settled_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_side_pots_scoring_method
        CHECK (scoring_method IN ('sum_placings', 'sum_scores')),
    CONSTRAINT ck_side_pots_eligibility_rule
        CHECK (eligibility_rule IN ('all_classes', 'any_class')),
    CONSTRAINT ck_side_pots_status
        CHECK (status IN ('open', 'closed', 'settled')),
    CONSTRAINT ck_side_pots_entry_fee_nonneg
        CHECK (entry_fee_cents >= 0),
    CONSTRAINT ck_side_pots_payback_range
        CHECK (payback_percent BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_side_pots_show
    ON side_pots (show_id);

CREATE TABLE IF NOT EXISTS side_pot_classes (
    side_pot_id  UUID NOT NULL REFERENCES side_pots(id) ON DELETE CASCADE,
    class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    PRIMARY KEY (side_pot_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_side_pot_classes_class
    ON side_pot_classes (class_id);

CREATE TABLE IF NOT EXISTS side_pot_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    side_pot_id     UUID NOT NULL REFERENCES side_pots(id) ON DELETE CASCADE,
    show_entry_id   UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    paid            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (side_pot_id, show_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_side_pot_entries_show_entry
    ON side_pot_entries (show_entry_id);

CREATE TABLE IF NOT EXISTS side_pot_payouts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    side_pot_id       UUID NOT NULL REFERENCES side_pots(id) ON DELETE CASCADE,
    show_entry_id     UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    place             INTEGER NOT NULL,
    payout_cents      INTEGER NOT NULL DEFAULT 0,
    aggregate_value   NUMERIC(12, 3) NOT NULL,
    tiebreaker_notes  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_side_pot_payouts_place_positive
        CHECK (place > 0),
    CONSTRAINT ck_side_pot_payouts_payout_nonneg
        CHECK (payout_cents >= 0),
    UNIQUE (side_pot_id, show_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_side_pot_payouts_pot_place
    ON side_pot_payouts (side_pot_id, place);

INSERT INTO _migrations (name) VALUES ('037_side_pots') ON CONFLICT DO NOTHING;

COMMIT;
