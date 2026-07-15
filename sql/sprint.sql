-- Sprint race results and sprint qualifying classification tables backing
-- GET /results/get-all-sprint-results/:season/:round and
-- GET /results/get-all-sprint-qualifying-results/:season/:round.
-- There is no migration tool in this project (see CLAUDE.md), so run this
-- file manually against Postgres once. The sync endpoints also create these
-- tables if missing, so running this file is optional but recommended.
--
-- Re-runnable: tables are created only if missing. Rows are populated by the
-- sync endpoints (/results/sync-sprint-results from Jolpica,
-- /results/sync-sprint-qualifying from OpenF1 — Jolpica has no sprint
-- qualifying endpoint).

CREATE TABLE IF NOT EXISTS sprint_results (
    id                TEXT PRIMARY KEY, -- <season>_<round>_<driverId>
    season            TEXT NOT NULL,
    round             TEXT NOT NULL,
    driver_number     TEXT,
    position          TEXT,
    points            TEXT,
    grid              TEXT,
    laps              TEXT,
    status            TEXT,
    time              TEXT,
    fastest_lap       TEXT,
    fastest_lap_rank  TEXT,
    fastest_lap_time  TEXT,
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sprint_qualifying (
    id                TEXT PRIMARY KEY, -- <season>_<round>_<driver_number>
    season            TEXT NOT NULL,
    round             TEXT NOT NULL,
    driver_number     TEXT,
    position          TEXT,
    sq1               TEXT,
    sq2               TEXT,
    sq3               TEXT,
    updated_at        TIMESTAMPTZ DEFAULT now()
);
