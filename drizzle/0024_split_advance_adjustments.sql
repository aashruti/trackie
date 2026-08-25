ALTER TABLE "invoices" ADD COLUMN "oem_advance_adj" numeric DEFAULT '0' NOT NULL;
--> statement-breakpoint
-- Preserve every existing invoice's current calculations. Users can then edit
-- either side independently when the University and OEM amounts differ.
UPDATE "invoices" SET "oem_advance_adj" = "advance_adj";
