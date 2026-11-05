ALTER TABLE "programs" ADD COLUMN "po_number" text;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "po_date" date;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "po_value" numeric;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "gst_rate" numeric DEFAULT '18' NOT NULL;
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "vendor" text;
--> statement-breakpoint
CREATE TABLE "program_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer REFERENCES "users"("id") ON DELETE set null,
	"updated_by" integer REFERENCES "users"("id") ON DELETE set null,
	"version" integer DEFAULT 1 NOT NULL,
	"program_id" integer NOT NULL REFERENCES "programs"("id") ON DELETE cascade,
	"received_date" date NOT NULL,
	"amount" numeric NOT NULL,
	"tds" numeric DEFAULT '0' NOT NULL,
	"reference" text,
	"note" text,
	CONSTRAINT "program_payments_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "program_payments_tds_check" CHECK ("tds" >= 0)
);
--> statement-breakpoint
CREATE INDEX "program_payments_program_idx" ON "program_payments" ("program_id");
--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "program_payments" FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "program_payments" FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
CREATE TABLE "program_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer REFERENCES "users"("id") ON DELETE set null,
	"updated_by" integer REFERENCES "users"("id") ON DELETE set null,
	"version" integer DEFAULT 1 NOT NULL,
	"program_id" integer NOT NULL REFERENCES "programs"("id") ON DELETE cascade,
	"payment_id" integer REFERENCES "program_payments"("id") ON DELETE cascade,
	"file_name" text NOT NULL,
	"pathname" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "program_files_program_idx" ON "program_files" ("program_id");
--> statement-breakpoint
CREATE INDEX "program_files_payment_idx" ON "program_files" ("payment_id");
--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "program_files" FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "program_files" FOR EACH ROW EXECUTE FUNCTION audit_row();
