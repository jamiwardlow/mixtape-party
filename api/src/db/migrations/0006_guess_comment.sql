-- #101: a guesser's note on their guess, shown to the league once results are open.
ALTER TABLE guesses ADD COLUMN IF NOT EXISTS comment TEXT;
