-- Migration 023: Add show_requests table for Show Manager show approval workflow
--
-- Show Managers submit a request to host a show. An admin reviews and approves or
-- rejects the request. On approval, a DRAFT show is automatically created from the
-- request data and the requesting manager is assigned via show_managers.

CREATE TABLE show_requests (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by_user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    show_name                       TEXT NOT NULL,
    show_type_id                    UUID NOT NULL REFERENCES show_types(id),
    venue_id                        UUID REFERENCES venues(id) ON DELETE SET NULL,
    start_date                      DATE NOT NULL,
    end_date                        DATE NOT NULL,
    manager_association_id          TEXT,       -- SM's membership/manager ID with the association
    association_approval_confirmed  BOOLEAN NOT NULL DEFAULT false,
    notes                           TEXT,       -- Additional details from the SM
    status                          TEXT NOT NULL DEFAULT 'PENDING'
                                        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_notes                     TEXT,       -- Reason for rejection (or approval notes)
    created_show_id                 UUID REFERENCES shows(id) ON DELETE SET NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_show_requests_requested_by ON show_requests(requested_by_user_id);
CREATE INDEX idx_show_requests_status       ON show_requests(status);
CREATE INDEX idx_show_requests_created_at   ON show_requests(created_at DESC);

INSERT INTO _migrations (name) VALUES ('023_show_requests.sql');
