CREATE TYPE "public"."activity_type" AS ENUM('call', 'email', 'meeting', 'note');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'progress', 'review', 'blocked', 'done');--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"type" "activity_type" DEFAULT 'note' NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"date_label" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"prospect" text NOT NULL,
	"city" text,
	"oem" text,
	"owner" text NOT NULL,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"value" numeric DEFAULT '0' NOT NULL,
	"students" integer DEFAULT 0 NOT NULL,
	"next_action" text,
	"next_date" text,
	"source" text,
	"contact_name" text,
	"contact_role" text,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"account" text,
	"oem" text,
	"assignee" text NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"due" text,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;