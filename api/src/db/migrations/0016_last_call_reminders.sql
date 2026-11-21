-- #208: a "last call" nudge 3 hours before each deadline, sent once per round.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS submission_last_call_sent_at TIMESTAMPTZ;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS guessing_last_call_sent_at TIMESTAMPTZ;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('submission_reminder', 'guessing_reminder', 'submission_last_call', 'guessing_last_call', 'guessing_open', 'results_ready', 'season_concluded', 'comment_reply', 'comment_reaction'));
