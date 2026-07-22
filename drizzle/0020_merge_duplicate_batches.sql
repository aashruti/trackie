-- 0019 canonicalized batch labels, which can FOLD two spellings of the same
-- intake year on one invoice (e.g. "2024-25" + "FY24-25" → two "FY24–25" rows).
-- The UI keys batches by label, so duplicates break editing (shared inputs,
-- duplicate React keys) and double-apply rollover overrides. This migration
-- merges them: counts sum into the lowest-id row, the rest are deleted.
--
-- Only price-agreeing groups are merged (identical price pair on every row,
-- nulls matching) — rows with CONFLICTING locked prices are money-bearing and
-- are deliberately left untouched for manual resolution on the account screen.
-- setCohorts now merges in JS, so new duplicates cannot be written.
--
-- Idempotent: on a clean database both statements match zero rows.
-- Audit triggers suspended for the same reason as 0019 (user-authorized):
-- a mechanical convention merge is not a user action, and the stale row
-- stamps would misattribute it.
ALTER TABLE "cohorts" DISABLE TRIGGER USER;--> statement-breakpoint
WITH mergeable AS (
  SELECT invoice_id, enrollment_year, MIN(id) AS keep_id, SUM("count") AS total
  FROM "cohorts"
  GROUP BY invoice_id, enrollment_year
  HAVING COUNT(*) > 1
     AND COUNT(DISTINCT COALESCE("price_to_uni"::text, '~') || '|' || COALESCE("price_to_datagami"::text, '~')) = 1
)
UPDATE "cohorts" c
SET "count" = m.total
FROM mergeable m
WHERE c.id = m.keep_id;--> statement-breakpoint
WITH mergeable AS (
  SELECT invoice_id, enrollment_year, MIN(id) AS keep_id
  FROM "cohorts"
  GROUP BY invoice_id, enrollment_year
  HAVING COUNT(*) > 1
     AND COUNT(DISTINCT COALESCE("price_to_uni"::text, '~') || '|' || COALESCE("price_to_datagami"::text, '~')) = 1
)
DELETE FROM "cohorts" c
USING mergeable m
WHERE c.invoice_id = m.invoice_id
  AND c.enrollment_year = m.enrollment_year
  AND c.id <> m.keep_id;--> statement-breakpoint
ALTER TABLE "cohorts" ENABLE TRIGGER USER;
