-- #167: reports outlive the reporter's account, and a reporter can't file the same one twice.
ALTER TABLE reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES accounts(id) ON DELETE SET NULL;
DELETE FROM reports a USING reports b WHERE a.reporter_id = b.reporter_id AND a.target_type = b.target_type AND a.target_id = b.target_id AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS reports_once_idx ON reports (reporter_id, target_type, target_id);
