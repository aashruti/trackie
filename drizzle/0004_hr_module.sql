-- HR module — leave, attendance & payroll.
-- Hand-trimmed from `drizzle-kit generate`: the auto-diff re-emitted objects that
-- already exist (task_comments, lead_followups, invoices.due_date, leads/tasks
-- columns, lead_stage/task_status values) because the meta snapshots had drifted
-- behind the hand-written 0002/0003 migrations. This file contains ONLY the new
-- HR-module DDL. The regenerated 0004 snapshot captures the true full schema.

-- ---- Enums (idempotent per project convention) ------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."employee_status" AS ENUM('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."leave_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."leave_accrual_mode" AS ENUM('annual', 'monthly');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."attendance_day_type" AS ENUM('office', 'wfh', 'official-visit', 'comp-off', 'paid-leave', 'unpaid-leave', 'weekly-off', 'holiday', 'absent');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."attendance_source" AS ENUM('scanner', 'manual', 'import', 'leave', 'auto-off');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."upload_status" AS ENUM('parsed', 'committed', 'discarded');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'finalized');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."late_lop_mode" AS ENUM('late-count', 'half-day-threshold');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Add the HR role to the existing `role` enum.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'hr';--> statement-breakpoint

-- ---- Tables -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"grace_minutes" integer DEFAULT 0 NOT NULL,
	"half_day_after_minutes" integer,
	"early_leave_before_minutes" integer,
	"full_day_minutes" integer DEFAULT 480 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"employee_code" text NOT NULL,
	"alt_codes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"biometric_id" text,
	"date_of_joining" date,
	"monthly_salary" numeric DEFAULT '0' NOT NULL,
	"shift_id" integer,
	"weekly_off_day" integer DEFAULT 0,
	"wfh_day" integer DEFAULT 6,
	"dob" date,
	"pan" text,
	"aadhar" text,
	"phone" text,
	"emergency_contacts" jsonb,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "employee_profiles_employee_code_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hr_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"late_lop_mode" "late_lop_mode" DEFAULT 'late-count' NOT NULL,
	"lates_per_lop_day" integer DEFAULT 3 NOT NULL,
	"absent_is_lop" boolean DEFAULT true NOT NULL,
	"working_days_basis" text DEFAULT 'calendar-minus-offs' NOT NULL,
	"cycle_start_day" integer DEFAULT 26 NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual_mode" "leave_accrual_mode" DEFAULT 'monthly' NOT NULL,
	"annual_entitlement" numeric DEFAULT '0' NOT NULL,
	"monthly_accrual" numeric DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "leave_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"year" integer NOT NULL,
	"carried_forward" numeric DEFAULT '0' NOT NULL,
	"accrued" numeric DEFAULT '0' NOT NULL,
	"used" numeric DEFAULT '0' NOT NULL,
	"unpaid_taken" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "leave_balances_employee_id_leave_type_id_year_unique" UNIQUE("employee_id","leave_type_id","year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"days" numeric NOT NULL,
	"reason" text NOT NULL,
	"status" "leave_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploaded_by_user_id" integer,
	"file_name" text NOT NULL,
	"blob_url" text,
	"period_start" date,
	"period_end" date,
	"row_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"status" "upload_status" DEFAULT 'parsed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_id" integer NOT NULL,
	"code" text NOT NULL,
	"employee_id" integer,
	"punch_at" timestamp NOT NULL,
	"raw" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"date" date NOT NULL,
	"day_type" "attendance_day_type" NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"is_early_leave" boolean DEFAULT false NOT NULL,
	"early_minutes" integer DEFAULT 0 NOT NULL,
	"first_in" time,
	"last_out" time,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"lop_days" numeric DEFAULT '0' NOT NULL,
	"source" "attendance_source" NOT NULL,
	"note" text,
	"overridden_by_user_id" integer,
	"upload_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_employee_id_date_unique" UNIQUE("employee_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"generated_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finalized_at" timestamp,
	CONSTRAINT "payroll_runs_month_year_unique" UNIQUE("month","year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"base_salary" numeric NOT NULL,
	"working_days" numeric NOT NULL,
	"present_days" numeric NOT NULL,
	"paid_leave_days" numeric DEFAULT '0' NOT NULL,
	"lop_days" numeric DEFAULT '0' NOT NULL,
	"lop_amount" numeric DEFAULT '0' NOT NULL,
	"net_pay" numeric NOT NULL,
	"breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_run_id_employee_id_unique" UNIQUE("run_id","employee_id")
);
--> statement-breakpoint

-- ---- Foreign keys -----------------------------------------------------------
DO $$ BEGIN ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attendance_uploads" ADD CONSTRAINT "attendance_uploads_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_upload_id_attendance_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."attendance_uploads"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_overridden_by_user_id_users_id_fk" FOREIGN KEY ("overridden_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_upload_id_attendance_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."attendance_uploads"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employee_profiles_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee_profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
