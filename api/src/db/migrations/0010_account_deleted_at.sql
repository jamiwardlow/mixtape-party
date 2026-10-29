-- #143: deleting an account scrubs the row in place (so others' season results keep their
-- submissions and guesses) and stamps it here. requireAuth rejects stamped accounts.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
