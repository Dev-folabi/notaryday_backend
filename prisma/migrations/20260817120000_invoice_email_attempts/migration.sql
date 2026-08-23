ALTER TABLE "invoices"
ADD COLUMN "email_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "email_last_attempt_at" TIMESTAMPTZ,
ADD COLUMN "email_last_error" TEXT,
ADD COLUMN "email_failed_at" TIMESTAMPTZ;

CREATE INDEX "invoices_email_pending_email_attempts_idx"
ON "invoices" ("email_pending", "email_attempts");
