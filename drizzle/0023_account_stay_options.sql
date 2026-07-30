CREATE TABLE "account_stay_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" integer NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"cost_per_night" numeric(12, 2),
	"booking_url" text,
	"contact_phone" text,
	CONSTRAINT "account_stay_options_cost_check" CHECK ("account_stay_options"."cost_per_night" IS NULL OR "account_stay_options"."cost_per_night" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_stay_options" ADD CONSTRAINT "account_stay_options_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_stay_options" ADD CONSTRAINT "account_stay_options_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_stay_options" ADD CONSTRAINT "account_stay_options_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "account_stay_options_account_id_idx" ON "account_stay_options" USING btree ("account_id");
--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "account_stay_options" FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "account_stay_options" FOR EACH ROW EXECUTE FUNCTION audit_row();
