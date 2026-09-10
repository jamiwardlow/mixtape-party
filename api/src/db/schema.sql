CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Repeat-safe fixes for accounts tables created before #46. A magic-link or Google user never
-- sets a password, so password_hash is nullable; google_sub is a column rather than an
-- identities table because there is exactly one provider and an account has at most one login.
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('apple_music', 'youtube_music', 'bandcamp')),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluded_notified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rounds (
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
  service TEXT NOT NULL CHECK (service IN ('apple_music', 'youtube_music', 'bandcamp')),
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
  service TEXT NOT NULL CHECK (service IN ('apple_music', 'youtube_music')),
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
  service TEXT NOT NULL CHECK (service IN ('apple_music', 'youtube_music')),
  playlist_external_id TEXT,
  matched_submission_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, account_id, service)
);

-- Per-account on/off toggle for each notification delivery channel (#30). No per-league or
-- per-notification-type granularity; a missing row means both channels default to enabled.
CREATE TABLE IF NOT EXISTS notification_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Device push tokens/subscriptions an account has registered, so a reminder or alert can reach them.
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('expo', 'web')),
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, platform, token)
);

-- In-app notification inbox. Always populated regardless of the push/email toggles above, since
-- the inbox itself has no channel toggle per #30's acceptance criteria.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('submission_reminder', 'guessing_reminder', 'results_ready', 'season_concluded')),
  round_id UUID REFERENCES rounds(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-use, hashed tokens backing password reset, magic-link sign-in and the Google handoff
-- (#46). Only the sha256 of the token is stored, so a database dump is not a pile of usable links.
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'sign_in')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_account_created_idx ON auth_tokens (account_id, created_at);
