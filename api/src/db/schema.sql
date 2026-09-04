CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'apple_music', 'youtube_music', 'bandcamp')),
  service_user_id TEXT NOT NULL,
  -- ponytail: tokens stored plaintext, relying on the managed Postgres provider's at-rest encryption.
  -- Upgrade to app-level column encryption if that guarantee isn't sufficient before storing real user tokens.
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, service)
);

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  season_length INTEGER NOT NULL CHECK (season_length > 0),
  host_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  theme TEXT NOT NULL,
  submission_deadline TIMESTAMPTZ NOT NULL,
  guessing_deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, round_number)
);

CREATE TABLE IF NOT EXISTS league_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, account_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'apple_music', 'youtube_music', 'bandcamp')),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  isrc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, account_id)
);

CREATE TABLE IF NOT EXISTS guesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  guesser_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  guessed_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, guesser_account_id)
);

-- Global, permanent cross-service match cache (#29): a track is only ever searched for once per
-- service, keyed by ISRC when known else normalized artist+title. A NULL external_id records a
-- confirmed no-match so it's never re-searched either.
CREATE TABLE IF NOT EXISTS track_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_key TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'apple_music', 'youtube_music')),
  external_id TEXT,
  title TEXT,
  artist TEXT,
  isrc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_key, service)
);

-- Tracks that a round's cross-service export has already run for a given player+service, so it
-- runs at most once per round rather than re-matching/re-appending on every request.
CREATE TABLE IF NOT EXISTS round_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'apple_music', 'youtube_music')),
  playlist_external_id TEXT,
  matched_submission_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, account_id, service)
);
