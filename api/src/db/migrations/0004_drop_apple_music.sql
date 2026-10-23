-- Apple Music was dropped entirely. Like 0001 (Spotify), no adapter is left to serve its rows, so
-- they are deleted rather than rewritten. service_links only ever held Apple Music tokens (the
-- other services run on server-held credentials), so the table goes too.
DELETE FROM submissions WHERE service = 'apple_music';
DELETE FROM track_matches WHERE service = 'apple_music';
DELETE FROM round_exports WHERE service = 'apple_music';
DROP TABLE IF EXISTS service_links;

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_service_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_service_check CHECK (service IN ('youtube_music', 'bandcamp'));

ALTER TABLE track_matches DROP CONSTRAINT IF EXISTS track_matches_service_check;
ALTER TABLE track_matches ADD CONSTRAINT track_matches_service_check CHECK (service IN ('youtube_music'));

ALTER TABLE round_exports DROP CONSTRAINT IF EXISTS round_exports_service_check;
ALTER TABLE round_exports ADD CONSTRAINT round_exports_service_check CHECK (service IN ('youtube_music'));
