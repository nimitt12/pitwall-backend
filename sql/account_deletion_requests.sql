-- Self-service account deletion requests, submitted from the frontend's
-- "Request Account Deletion" page (linked from the footer) and actioned by
-- an admin from the admin portal's generic table CRUD (see adminService.js
-- TABLES.account_deletion_requests). There is no migration tool in this
-- project (see CLAUDE.md), so run this file manually against Postgres once.
--
-- Re-runnable: the table is created only if missing.

CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    email        TEXT NOT NULL,
    reason       TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);
