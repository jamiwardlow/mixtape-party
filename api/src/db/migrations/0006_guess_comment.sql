-- #101: a guesser's note on their guess, shown to the league once results are open.
ALTER TABLE guesses ADD COLUMN IF NOT EXISTS comment TEXT;

-- Someone replied to your comment or reply.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('submission_reminder', 'guessing_reminder', 'guessing_open', 'results_ready', 'season_concluded', 'comment_reply', 'comment_reaction'));
