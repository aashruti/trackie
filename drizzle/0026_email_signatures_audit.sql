CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "email_signatures" FOR EACH ROW EXECUTE FUNCTION stamp_row();
--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "email_signatures" FOR EACH ROW EXECUTE FUNCTION audit_row();
