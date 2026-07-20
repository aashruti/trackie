-- audit foundation: base-entity columns + generic audit triggers.
-- Additive only: adds columns (new values), one empty table, two functions,
-- and triggers. No existing row is read, updated, or deleted.

-- 1) audit_log
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigserial PRIMARY KEY,
  "at" timestamp NOT NULL DEFAULT now(),
  "table_name" text NOT NULL,
  "op" text NOT NULL,
  "row_id" text,
  -- actor_id deliberately has NO foreign key to users(id). An audit log must
  -- outlive the data it audits, and an FK breaks that two ways:
  --  (a) ON DELETE SET NULL retroactively strips attribution from a departed
  --      user's entire audit history — the log silently rewrites itself.
  --  (b) it aborts cascade deletes mid-flight: when a cascaded child row's
  --      updated_by is the very user being deleted, that row's DELETE trigger
  --      INSERTs an audit row referencing a users row already removed in the
  --      same statement, and the whole delete rolls back.
  -- Readers resolve actor names with a LEFT JOIN, which works fine against a
  -- plain integer (and correctly yields NULL for a since-deleted actor).
  "actor_id" integer,
  "before" jsonb,
  "after" jsonb
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_table_at_idx" ON "audit_log" ("table_name","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_at_idx" ON "audit_log" ("actor_id","at");--> statement-breakpoint
-- 2) base columns on every audited table (30). ADD COLUMN IF NOT EXISTS is
--    idempotent and skips columns that already exist, so no data is rewritten.
ALTER TABLE "oems"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "account_groups"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "academic_years"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "cohorts"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "user_accounts"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "user_roles"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "task_comments"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "lead_followups"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "lead_activities"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "shifts"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "employee_profiles"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "holidays"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "hr_settings"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "leave_types"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "leave_balances"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "leave_requests"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "attendance_uploads"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "payslips"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "delivery_methods"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "programs"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "delivery_events"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "delivery_activities"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
-- 3) trigger functions
CREATE OR REPLACE FUNCTION stamp_row() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = public;--> statement-breakpoint
-- audit_row notes:
--  (a) Three keys are stripped from the before/after images:
--        password_hash — a credential; an append-only log must never hold one.
--        aadhar, pan   — regulated identifiers (Aadhaar numbers are governed
--                        storage under the Aadhaar Act). audit_log is
--                        append-only with no retention policy, so every
--                        historical value would otherwise live forever in a
--                        second, uncontrolled copy outside employee_profiles.
--      Redaction hides only the VALUES: the mutation itself is still fully
--      audited (table, op, row_id, actor, timestamp, and every other column's
--      before/after), so "who changed this employee's record and when" stays
--      answerable — only the regulated fields' contents are omitted.
--      The jsonb "-" operator is a no-op on tables lacking these keys, so the
--      function stays generic across all audited tables.
--  (b) ON DELETE SET NULL referential actions DO fire these triggers — such
--      audit rows have actor NULL (accepted; the row's original updated_by is
--      still visible in the before image).
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger AS $$
DECLARE v_actor int; v_row text; j_old jsonb; j_new jsonb;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    j_old := to_jsonb(OLD) - 'password_hash' - 'aadhar' - 'pan';
    v_actor := (j_old ->> 'updated_by')::int;
    v_row := j_old ->> 'id';
    INSERT INTO audit_log(table_name, op, row_id, actor_id, before, after)
      VALUES (TG_TABLE_NAME, TG_OP, v_row, v_actor, j_old, NULL);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    j_old := to_jsonb(OLD) - 'password_hash' - 'aadhar' - 'pan';
    j_new := to_jsonb(NEW) - 'password_hash' - 'aadhar' - 'pan';
    v_actor := (j_new ->> 'updated_by')::int;
    v_row := j_new ->> 'id';
    INSERT INTO audit_log(table_name, op, row_id, actor_id, before, after)
      VALUES (TG_TABLE_NAME, TG_OP, v_row, v_actor, j_old, j_new);
    RETURN NEW;
  ELSE
    j_new := to_jsonb(NEW) - 'password_hash' - 'aadhar' - 'pan';
    v_actor := (j_new ->> 'updated_by')::int;
    v_row := j_new ->> 'id';
    INSERT INTO audit_log(table_name, op, row_id, actor_id, before, after)
      VALUES (TG_TABLE_NAME, TG_OP, v_row, v_actor, NULL, j_new);
    RETURN NEW;
  END IF;
END; $$ LANGUAGE plpgsql SET search_path = public;--> statement-breakpoint
-- 4) triggers per audited table
DROP TRIGGER IF EXISTS "trg_stamp" ON "oems";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "oems" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "oems";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "oems" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "account_groups";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "account_groups" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "account_groups";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "account_groups" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "accounts";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "accounts" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "accounts";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "accounts" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "academic_years";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "academic_years" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "academic_years";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "academic_years" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "invoices";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "invoices";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "cohorts";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "cohorts" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "cohorts";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "cohorts" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "payments";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "payments";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "users";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "users";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "user_accounts";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "user_accounts" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "user_accounts";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "user_accounts" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "user_roles";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "user_roles" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "user_roles";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "user_roles" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "tasks";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "tasks" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "tasks";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "task_comments";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "task_comments" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "task_comments";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "task_comments" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "leads";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "leads" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "leads";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "leads" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "lead_followups";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "lead_followups" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "lead_followups";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "lead_followups" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "lead_activities";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "lead_activities" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "lead_activities";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "lead_activities" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "shifts";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "shifts" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "shifts";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "shifts" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "employee_profiles";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "employee_profiles" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "employee_profiles";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "employee_profiles" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "holidays";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "holidays" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "holidays";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "holidays" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "hr_settings";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "hr_settings" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "hr_settings";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "hr_settings" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "leave_types";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "leave_types" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "leave_types";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "leave_types" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "leave_balances";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "leave_balances" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "leave_balances";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "leave_balances" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "leave_requests";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "leave_requests";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "attendance_uploads";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "attendance_uploads" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "attendance_uploads";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "attendance_uploads" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "attendance_records";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "attendance_records" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "attendance_records";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "attendance_records" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "payroll_runs";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "payroll_runs";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "payslips";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "payslips" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "payslips";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "payslips" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "delivery_methods";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "delivery_methods" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "delivery_methods";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "delivery_methods" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "programs";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "programs" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "programs";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "programs" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "delivery_events";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "delivery_events" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "delivery_events";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "delivery_events" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "delivery_activities";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "delivery_activities" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "delivery_activities";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "delivery_activities" FOR EACH ROW EXECUTE FUNCTION audit_row();
