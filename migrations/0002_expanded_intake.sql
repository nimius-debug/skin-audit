-- Adds the expanded product, health, and consent questionnaire to an existing
-- production database. Detailed intake answers are JSON so future questions
-- can evolve without requiring a column for every form control.

ALTER TABLE submissions ADD COLUMN intake_details TEXT;
ALTER TABLE submissions ADD COLUMN service_acknowledgment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN photo_marketing_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN signature_name TEXT;
ALTER TABLE submissions ADD COLUMN consent_version TEXT;
ALTER TABLE submissions ADD COLUMN consented_at TEXT;
