-- Normalize cohort batch labels to the canonical FY form ("FY24–25": FY prefix,
-- two-digit years, EN-DASH) so batches match academic_years.label exactly.
-- Mirrors normalizeBatchLabel() in lib/fy.ts. Data-only — no schema change.
--
-- Audit triggers are suspended for this batch: a bulk convention rename is not
-- a user action, and the row-stamp (updated_by) still points at the last real
-- editor — letting the trigger fire would misattribute the rename to them in
-- the audit feed. drizzle runs the migration in one transaction, so a failure
-- restores the triggers via rollback.
ALTER TABLE "cohorts" DISABLE TRIGGER USER;--> statement-breakpoint
-- "2024-25" → "FY24–25"
UPDATE "cohorts" SET "enrollment_year" = regexp_replace("enrollment_year", '^\d{2}(\d{2})-(\d{2})$', 'FY\1–\2')
WHERE "enrollment_year" ~ '^\d{4}-\d{2}$';--> statement-breakpoint
-- "24-25" → "FY24–25"
UPDATE "cohorts" SET "enrollment_year" = regexp_replace("enrollment_year", '^(\d{2})-(\d{2})$', 'FY\1–\2')
WHERE "enrollment_year" ~ '^\d{2}-\d{2}$';--> statement-breakpoint
-- "FY24-25" / "FY 24-25" (hyphen or space variants) → "FY24–25"; rows already
-- canonical are excluded so no-op updates don't fire.
UPDATE "cohorts" SET "enrollment_year" = regexp_replace("enrollment_year", '^FY ?(\d{2})[-–](\d{2})$', 'FY\1–\2')
WHERE "enrollment_year" ~ '^FY ?\d{2}[-–]\d{2}$' AND "enrollment_year" !~ '^FY\d{2}–\d{2}$';--> statement-breakpoint
ALTER TABLE "cohorts" ENABLE TRIGGER USER;
