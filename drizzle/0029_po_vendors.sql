CREATE TABLE IF NOT EXISTS "po_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer REFERENCES "users"("id") ON DELETE set null,
	"updated_by" integer REFERENCES "users"("id") ON DELETE set null,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "po_vendors_name_lower_idx" ON "po_vendors" (lower("name"));
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_stamp" ON "po_vendors";
--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "po_vendors" FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "po_vendors";
--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "po_vendors" FOR EACH ROW EXECUTE FUNCTION audit_row();
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "vendor_id" integer REFERENCES "po_vendors"("id") ON DELETE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_vendor_idx" ON "programs" ("vendor_id");
--> statement-breakpoint
-- Backfill: one vendor per distinct case-insensitive, trimmed, non-empty
-- free-text vendor (any one spelling wins). Idempotent; no transaction needed.
INSERT INTO "po_vendors" ("name")
SELECT DISTINCT ON (lower(btrim("vendor"))) btrim("vendor")
FROM "programs"
WHERE "vendor" IS NOT NULL AND btrim("vendor") <> ''
ORDER BY lower(btrim("vendor")), btrim("vendor")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "programs" AS p
SET "vendor_id" = v."id"
FROM "po_vendors" AS v
WHERE p."vendor_id" IS NULL
  AND p."vendor" IS NOT NULL
  AND lower(btrim(p."vendor")) = lower(v."name");
