-- Bandcamp cover art id, read off the track page at submit time. Null for other services and for
-- tracks submitted before this column existed.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS art_id BIGINT;
