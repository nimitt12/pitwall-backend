-- Extra result field used by the season speed index. Re-runnable.
ALTER TABLE results ADD COLUMN IF NOT EXISTS fastest_lap_speed TEXT;
