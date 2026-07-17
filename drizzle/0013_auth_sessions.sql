-- Backend session store. Auth.js still issues the JWT (it requires the jwt
-- strategy for Credentials providers), but each token carries a `sid` and the
-- jwt callback checks the row here every request — so deleting rows revokes
-- sessions. Password change deletes every row for that user.
-- No expires_at: Auth.js verifies the JWT's own exp before our callback runs,
-- so a stale row can never resurrect an expired token.
-- Spec: docs/superpowers/specs/2026-07-17-session-revocation-on-password-change-design.md
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
