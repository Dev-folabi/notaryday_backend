-- Account settings gaps: soft-delete flag, US state, and notification prefs.
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ;

ALTER TABLE "user_settings" ADD COLUMN "state" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "notification_prefs" JSONB;
