-- Repair stamp_row(): don't re-stamp on attribution-only updates.
--
-- Why this is a separate migration rather than an edit to 0016: 0016 has
-- already been recorded as applied (drizzle skips a migration whose tag is in
-- __drizzle_migrations, regardless of whether the file's content later
-- changed), so editing 0016 can never reach a database that already ran it.
-- Anything that must land on an already-migrated database needs its own file.
--
-- The bug being fixed: created_by/updated_by are ON DELETE SET NULL to
-- users.id, and Postgres implements that referential action as an internal
-- UPDATE on every referencing row. The original stamp_row fired on those,
-- so deleting a single user rewrote updated_at to the deletion timestamp and
-- inflated version on every row that user had ever authored or touched --
-- irreversibly destroying the edit history the column exists to record, on
-- rows nobody edited.
--
-- CREATE OR REPLACE, so this is idempotent and safe to re-run.
CREATE OR REPLACE FUNCTION stamp_row() RETURNS trigger AS $$
BEGIN
  -- Only a real edit re-stamps the row. If the sole difference is attribution
  -- (created_by / updated_by), leave updated_at and version alone. This also
  -- stops stamped-delete's pre-stamp (which writes only updated_by) from
  -- bumping version on its way out.
  IF (to_jsonb(OLD) - 'created_by' - 'updated_by' - 'updated_at' - 'version')
     IS DISTINCT FROM
     (to_jsonb(NEW) - 'created_by' - 'updated_by' - 'updated_at' - 'version') THEN
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = public;
