-- #100: a notification when guessing opens, sent once per round.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS guessing_notified_at TIMESTAMPTZ;

-- Rounds already past their submission deadline must not all fire at once on deploy.
UPDATE rounds SET guessing_notified_at = now() WHERE guessing_notified_at IS NULL AND submission_deadline <= now();

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('submission_reminder', 'guessing_reminder', 'guessing_open', 'results_ready', 'season_concluded'));
