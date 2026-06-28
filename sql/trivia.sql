-- Trivia lines backing the public GET /trivia endpoint and the admin portal's
-- "Trivia" tab. These are the short sentences scrolled in the homepage ticker.
-- There is no migration tool in this project (see CLAUDE.md), so run this file
-- manually against Postgres once.
--
-- Re-runnable: the table is created only if missing. The seed below is wrapped
-- so it only inserts when the table is empty, leaving any lines you've edited
-- in the admin portal untouched on re-run.

CREATE TABLE IF NOT EXISTS trivia (
    id          TEXT PRIMARY KEY,
    body        TEXT NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed a couple of example lines only when the table has no rows yet.
INSERT INTO trivia ("id", "body", "sort_order")
SELECT * FROM (VALUES
    ('seed-1', 'WELCOME TO PITWALL — YOUR FRONT ROW SEAT TO THE 2026 SEASON.', 0),
    ('seed-2', 'EDIT THESE LINES ANYTIME FROM THE ADMIN PORTAL''S TRIVIA TAB.', 1)
) AS seed(id, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM trivia);
