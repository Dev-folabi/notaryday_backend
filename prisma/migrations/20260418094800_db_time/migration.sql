/*
  Warnings:

  - You are about to alter the column `irs_rate_snapshot` on the `jobs` table. The data in that column could be lost. The data in that column will be cast from `Decimal(8,2)` to `Decimal(5,4)`.
  - You are about to drop the `Scanback` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Scanback" DROP CONSTRAINT "Scanback_job_id_fkey";

-- AlterTable
ALTER TABLE "bookings" ALTER COLUMN "requested_time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "alternative_times" SET DATA TYPE TIMESTAMPTZ[],
ALTER COLUMN "submitted_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "reviewed_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "confirmed_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "calendar_connections" ALTER COLUMN "token_expires_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last_synced_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "day_plans" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "email_imports" ALTER COLUMN "parsed_appointment_time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "received_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "processed_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "expenses" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "geocode_cache" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last_used_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "paid_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "jobs" ALTER COLUMN "appointment_time" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "signing_ends_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "confirmed_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "scanning_started_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "irs_rate_snapshot" SET DATA TYPE DECIMAL(5,4);

-- AlterTable
ALTER TABLE "journal_entries" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "lemonsqueezy_events" ALTER COLUMN "processed_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "read_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "signing_type_defaults" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "plan_expires_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "last_seen_at" SET DATA TYPE TIMESTAMPTZ;

-- DropTable
DROP TABLE "Scanback";

-- CreateTable
CREATE TABLE "scanbacks" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "start_time" TIMESTAMPTZ NOT NULL,
    "end_time" TIMESTAMPTZ NOT NULL,
    "location" TEXT NOT NULL,
    "status" "ScanbackStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scanbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_day_plan_id_idx" ON "jobs"("day_plan_id");

-- AddForeignKey
ALTER TABLE "scanbacks" ADD CONSTRAINT "scanbacks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
