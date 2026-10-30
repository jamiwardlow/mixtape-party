-- #141: Sign in with Apple. Same shape as google_sub: one stable provider id per account.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS apple_sub TEXT UNIQUE;
