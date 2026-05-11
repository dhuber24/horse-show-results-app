-- Enforce one exhibitor row per user (1:1 for linked exhibitors).
-- Walk-in exhibitors with NULL user_id are still allowed without limit.

-- Remove duplicate exhibitor rows that have no child data,
-- keeping the oldest row per user_id. If a duplicate has children
-- attached, this leaves it in place and the unique-index creation
-- below will fail loudly so an operator can reconcile manually.
DELETE FROM exhibitors e
WHERE e.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM exhibitors e2
    WHERE e2.user_id = e.user_id
      AND e2.created_at < e.created_at
  )
  AND NOT EXISTS (SELECT 1 FROM entries WHERE exhibitor_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM show_entries WHERE exhibitor_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM horses WHERE owner_exhibitor_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM exhibitor_horses WHERE exhibitor_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM exhibitor_documents WHERE exhibitor_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM exhibitor_registrations WHERE exhibitor_id = e.id);

CREATE UNIQUE INDEX IF NOT EXISTS exhibitors_user_id_uniq
    ON exhibitors (user_id)
    WHERE user_id IS NOT NULL;
