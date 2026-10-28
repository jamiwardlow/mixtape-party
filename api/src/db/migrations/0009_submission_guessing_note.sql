-- #128: the submitter's own note on their track, written while guessing is open. Separate from
-- `comment` (set at submit time) so results can show both without one overwriting the other.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS guessing_note TEXT;
