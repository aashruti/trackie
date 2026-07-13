-- Delivery module: `delivery` role, teaching-style catalogue, programs under
-- accounts (own provider + method per program), budgeted events, activity log,
-- and the board discriminator + program link on tasks.
-- Spec: docs/superpowers/specs/2026-07-14-delivery-module-design.md
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'delivery';--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."program_status" AS ENUM('planned','active','completed','on-hold');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."delivery_event_status" AS ENUM('planned','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."delivery_activity_type" AS ENUM('session','meeting','logistics','procurement','milestone','expense','note');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."task_board" AS ENUM('team','delivery');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "delivery_methods_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"oem_id" integer NOT NULL,
	"delivery_method_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "program_status" DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"total_budget" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"venue" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"budget" numeric DEFAULT '0' NOT NULL,
	"status" "delivery_event_status" DEFAULT 'planned' NOT NULL,
	"owner_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"type" "delivery_activity_type" DEFAULT 'note' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"activity_date" date NOT NULL,
	"cost" numeric DEFAULT '0' NOT NULL,
	"created_by_user_id" integer,
	"author" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "board" "task_board" DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "program_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "programs" ADD CONSTRAINT "programs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "programs" ADD CONSTRAINT "programs_oem_id_oems_id_fk" FOREIGN KEY ("oem_id") REFERENCES "public"."oems"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "programs" ADD CONSTRAINT "programs_delivery_method_id_delivery_methods_id_fk" FOREIGN KEY ("delivery_method_id") REFERENCES "public"."delivery_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_activities" ADD CONSTRAINT "delivery_activities_event_id_delivery_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."delivery_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_activities" ADD CONSTRAINT "delivery_activities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
