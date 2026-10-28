-- #114: profile picture, stored inline (see the ponytail note in routes/accounts.ts).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar BYTEA;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_content_type TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
