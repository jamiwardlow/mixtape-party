-- #51 removed 'spotify' from schema.sql's CHECK constraints, but on a database where
-- service_links/submissions/track_matches/round_exports already exist, schema.sql's
-- CREATE TABLE IF NOT EXISTS is a no-op and the old constraints (and any 'spotify' rows)
-- survive. There is no adapter left to serve a 'spotify' row (registry.ts's adapterFor
-- throws), so legacy rows are deleted rather than rewritten to another service -- there is
-- no service a Spotify submission or link correctly maps to.
DELETE FROM submissions WHERE service = 'spotify';
DELETE FROM service_links WHERE service = 'spotify';
DELETE FROM track_matches WHERE service = 'spotify';
DELETE FROM round_exports WHERE service = 'spotify';

ALTER TABLE service_links DROP CONSTRAINT IF EXISTS service_links_service_check;
ALTER TABLE service_links ADD CONSTRAINT service_links_service_check CHECK (service IN ('apple_music', 'youtube_music', 'bandcamp'));

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_service_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_service_check CHECK (service IN ('apple_music', 'youtube_music', 'bandcamp'));

ALTER TABLE track_matches DROP CONSTRAINT IF EXISTS track_matches_service_check;
ALTER TABLE track_matches ADD CONSTRAINT track_matches_service_check CHECK (service IN ('apple_music', 'youtube_music'));

ALTER TABLE round_exports DROP CONSTRAINT IF EXISTS round_exports_service_check;
ALTER TABLE round_exports ADD CONSTRAINT round_exports_service_check CHECK (service IN ('apple_music', 'youtube_music'));
