-- Shared HR inbox CC'd on leave-application notifications.
ALTER TABLE "hr_settings" ADD COLUMN IF NOT EXISTS "notification_email" text DEFAULT 'hr@datagami.in';
