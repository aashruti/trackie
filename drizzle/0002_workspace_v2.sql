-- Workspace v2: leads pricing + converted/created_by + date next_date + lost stage
-- + lead_followups + tasks FK columns + task_comments
ALTER TABLE "leads" ADD COLUMN "price_to_uni" numeric NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "price_to_datagami" numeric NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_account_id" integer REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "next_date";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "next_date" date;--> statement-breakpoint
ALTER TYPE "lead_stage" ADD VALUE IF NOT EXISTS 'lost' AFTER 'won';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
CREATE TABLE "lead_followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"action" text NOT NULL,
	"due_date" date,
	"done" boolean NOT NULL DEFAULT false,
	"created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "account";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "oem";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "assignee";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "due";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "account_id" integer REFERENCES "accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_id" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'open' BEFORE 'progress';--> statement-breakpoint
CREATE TYPE "public"."task_comment_kind" AS ENUM('worklog', 'comment');--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"kind" "task_comment_kind" NOT NULL DEFAULT 'comment',
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
