-- Applied to skin-audit-db. Kept here so the schema is reproducible.

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  week_of         TEXT NOT NULL,  -- the date submitted (YYYY-MM-DD); label only, not a gating bucket
  status          TEXT NOT NULL DEFAULT 'new',
  name            TEXT NOT NULL,
  handle          TEXT NOT NULL,
  concern         TEXT,
  duration        TEXT,
  tried           TEXT,
  result          TEXT,
  morning_routine TEXT,
  night_routine   TEXT,
  after_wash      TEXT,
  lifestyle       TEXT,
  optin           INTEGER NOT NULL DEFAULT 0,
  photo_front     TEXT,
  photo_left      TEXT,
  photo_right     TEXT,
  photo_shelfie   TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS waitlist (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name       TEXT NOT NULL,
  handle     TEXT NOT NULL,
  notified   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);

-- Spots are controlled from /admin, not reset on a calendar schedule. One
-- fixed row (id = 1); the Worker seeds it with defaults on first read if
-- it's ever missing, so this INSERT is a convenience, not a requirement.
--
-- "Remaining" is never stored — it's always total_spots minus a live COUNT
-- of submissions since round_started_at, so it can never drift from what
-- actually landed in the submissions table. round_started_at moves forward
-- only when Laura hits "Refill & reopen".
CREATE TABLE IF NOT EXISTS settings (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  total_spots       INTEGER NOT NULL DEFAULT 5,
  is_open           INTEGER NOT NULL DEFAULT 1,
  round_started_at  TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO settings (id, total_spots, is_open, round_started_at)
VALUES (1, 5, 1, '1970-01-01T00:00:00.000Z');
