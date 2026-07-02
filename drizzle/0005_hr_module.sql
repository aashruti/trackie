-- Email verification: notifications are only sent to verified addresses.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;
