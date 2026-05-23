-- Migration 052: Drop show_requests table
--
-- The Show Manager approval workflow has been removed. Show Managers now create
-- shows directly via the admin show creation UI (POST /shows/ already auto-links
-- the requesting manager via show_managers).

DROP TABLE IF EXISTS show_requests;

INSERT INTO _migrations (name) VALUES ('052_drop_show_requests.sql');
