-- Applied to skin-audit-db. Kept here so the schema is reproducible.

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  week_of         TEXT NOT NULL,
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
