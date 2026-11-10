-- Bandcamp's real track/album page, stored at submit time so the web client can open it (#197).
-- Null for other services and for Bandcamp tracks submitted before this column existed.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS page_url TEXT;
