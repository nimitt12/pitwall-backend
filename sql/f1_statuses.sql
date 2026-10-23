-- Cached all-time race outcome counts sourced from Jolpica's Ergast API.
-- The statistics service also creates this table safely on first use so local
-- development does not depend on a separate migration step.
CREATE TABLE IF NOT EXISTS f1_statuses (
  status_id INTEGER PRIMARY KEY CHECK (status_id >= 0),
  status VARCHAR(120) NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
