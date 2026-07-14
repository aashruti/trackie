-- Account groups: manual grouping of accounts that belong to one university,
-- powering the grouped profitability view. One group per account; deleting a
-- group ungroups its members (SET NULL) — accounts and money are untouched.
-- Spec: docs/superpowers/specs/2026-07-14-account-groups-design.md
CREATE TABLE IF NOT EXISTS "account_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_name_unique" UNIQUE("name")
);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "group_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
