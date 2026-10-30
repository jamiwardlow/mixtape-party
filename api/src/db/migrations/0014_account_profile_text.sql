-- #176: optional pronouns/pronunciation and About Me on the account. Nullable, no backfill.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS about_me TEXT;
