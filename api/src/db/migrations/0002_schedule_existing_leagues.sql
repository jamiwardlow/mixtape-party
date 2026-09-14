-- #74 makes a league's whole season real at creation time: every round is inserted up front with
-- deadlines derived from round 1. Leagues created before that only ever got the rounds their host
-- started by hand, so the rest of their season is scheduled here the same way the API now does it
-- -- each round one (guessing_deadline - submission_deadline) window after the last.

-- Before submission_opens_at existed, created_at was when a round's submission window opened,
-- because a round was inserted the moment it started.
UPDATE rounds SET submission_opens_at = created_at WHERE submission_opens_at IS NULL;

-- Anchored on each league's *last* round, not its first: a league already on round 3 would
-- otherwise get rounds 4..N stamped with round-1-era dates, all of them in the past, which reads
-- as a concluded season the moment the migration lands. Starting the series at last + 1 also
-- leaves every round the host scheduled by hand exactly as they set it, and makes a second run a
-- no-op.
WITH anchor AS (
  SELECT DISTINCT ON (league_id) league_id, round_number, submission_deadline, guessing_deadline
  FROM rounds ORDER BY league_id, round_number DESC
)
INSERT INTO rounds (league_id, round_number, theme, submission_opens_at, submission_deadline, guessing_deadline)
SELECT a.league_id,
       n,
       NULL,
       a.submission_deadline + (a.guessing_deadline - a.submission_deadline) * (n - a.round_number - 1),
       a.guessing_deadline + (a.guessing_deadline - a.submission_deadline) * (n - a.round_number - 1),
       a.guessing_deadline + (a.guessing_deadline - a.submission_deadline) * (n - a.round_number)
FROM anchor a
JOIN leagues l ON l.id = a.league_id
CROSS JOIN LATERAL generate_series(a.round_number + 1, l.season_length) AS n;
