-- Schema as it existed at commit bfe7920^ (before "Remove Spotify integration entirely"),
-- trimmed to the tables this migration touches, kept for migrate.test.ts to boot a "legacy"
-- database against which the 0001_drop_spotify_service migration is verified.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'apple_music', 'youtube_music', 'bandcamp')),
  service_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, service)
);

CREATE TABLE leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  season_length INTEGER NOT NULL CHECK (season_length > 0),
  host_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluded_notified_at TIMESTAMPTZ
);

CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  theme TEXT NOT NULL,
  submission_deadline TIMESTAMPTZ NOT NULL,
  guessing_deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submission_reminder_sent_at TIMESTAMPTZ,
  guessing_reminder_sent_at TIMESTAMPTZ,
  results_notified_at TIMESTAMPTZ,
  UNIQUE (league_id, round_number)
);

CREATE TABLE submissions (
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

CREATE TABLE guesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  guesser_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  guessed_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, guesser_account_id)
);

CREATE TABLE track_matches (
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

CREATE TABLE round_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('spotify', 'apple_music', 'youtube_music')),
  playlist_external_id TEXT,
  matched_submission_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, account_id, service)
);
