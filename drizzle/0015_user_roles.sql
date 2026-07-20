-- Split the single role into a stackable set.
--  1. admin → sales (rename; existing admin rows read as sales automatically)
--  2. user_roles join: a user holds one OR MORE roles (union of permissions)
--  3. backfill each user's current scalar role into user_roles
--  4. safety: existing delivery users get ALL accounts assigned, so newly
--     scoping delivery (spec §5) doesn't drop them to zero visibility on deploy
-- users.role (scalar) is kept as a rollback seed; a follow-up PR drops it.
-- Spec: docs/superpowers/specs/2026-07-17-stackable-team-roles-design.md
ALTER TYPE "role" RENAME VALUE 'admin' TO 'sales';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" integer NOT NULL,
	"role" "role" NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_roles_user_id_idx" ON "user_roles" ("user_id");--> statement-breakpoint
-- backfill: one row per user from their current scalar role
INSERT INTO "user_roles" ("user_id", "role")
  SELECT "id", "role" FROM "users"
  ON CONFLICT DO NOTHING;--> statement-breakpoint
-- delivery-scoping safety: any delivery user with no account assignments gets all
INSERT INTO "user_accounts" ("user_id", "account_id")
  SELECT u."id", a."id"
  FROM "users" u
  CROSS JOIN "accounts" a
  WHERE u."role" = 'delivery'
    AND NOT EXISTS (SELECT 1 FROM "user_accounts" ua WHERE ua."user_id" = u."id")
  ON CONFLICT DO NOTHING;
