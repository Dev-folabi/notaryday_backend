/*
  Warnings:

  - You are about to drop the column `scanback_duration_mins` on the `jobs` table. All the data in the column will be lost.
  - You are about to drop the column `scanback_ends_at` on the `jobs` table. All the data in the column will be lost.
  - You are about to drop the column `stripe_customer_id` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `stripe_subscription_id` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[day_plan_id,route_sequence]` on the table `jobs` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[lemon_squeezy_customer_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[lemon_squeezy_subscription_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `irs_rate_snapshot` to the `jobs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScanbackStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- DropIndex
DROP INDEX "users_stripe_customer_id_key";

-- DropIndex
DROP INDEX "users_stripe_subscription_id_key";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "deleted_at" DATE,
ALTER COLUMN "requested_time" SET DATA TYPE DATE,
ALTER COLUMN "alternative_times" SET DATA TYPE DATE[],
ALTER COLUMN "submitted_at" SET DATA TYPE DATE,
ALTER COLUMN "reviewed_at" SET DATA TYPE DATE,
ALTER COLUMN "confirmed_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "calendar_connections" ALTER COLUMN "token_expires_at" SET DATA TYPE DATE,
ALTER COLUMN "last_synced_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "email_imports" ALTER COLUMN "parsed_appointment_time" SET DATA TYPE DATE,
ALTER COLUMN "received_at" SET DATA TYPE DATE,
ALTER COLUMN "processed_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "deleted_at" DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "geocode_cache" ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "last_used_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "deleted_at" DATE,
ALTER COLUMN "sent_at" SET DATA TYPE DATE,
ALTER COLUMN "paid_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "jobs" DROP COLUMN "scanback_duration_mins",
DROP COLUMN "scanback_ends_at",
ADD COLUMN     "day_plan_id" TEXT,
ADD COLUMN     "deleted_at" DATE,
ADD COLUMN     "irs_rate_snapshot" DECIMAL(8,2) NOT NULL,
ALTER COLUMN "appointment_time" SET DATA TYPE DATE,
ALTER COLUMN "signing_ends_at" SET DATA TYPE DATE,
ALTER COLUMN "confirmed_at" SET DATA TYPE DATE,
ALTER COLUMN "started_at" SET DATA TYPE DATE,
ALTER COLUMN "scanning_started_at" SET DATA TYPE DATE,
ALTER COLUMN "completed_at" SET DATA TYPE DATE,
ALTER COLUMN "cancelled_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "deleted_at" DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "lemonsqueezy_events" ALTER COLUMN "processed_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "read_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "password_reset_tokens" ALTER COLUMN "expires_at" SET DATA TYPE DATE,
ALTER COLUMN "used_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "signing_type_defaults" ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "stripe_customer_id",
DROP COLUMN "stripe_subscription_id",
ADD COLUMN     "lemon_squeezy_customer_id" TEXT,
ADD COLUMN     "lemon_squeezy_subscription_id" TEXT,
ALTER COLUMN "plan_expires_at" SET DATA TYPE DATE,
ALTER COLUMN "created_at" SET DATA TYPE DATE,
ALTER COLUMN "updated_at" SET DATA TYPE DATE,
ALTER COLUMN "last_seen_at" SET DATA TYPE DATE;

-- CreateTable
CREATE TABLE "day_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_drive_time" INTEGER NOT NULL DEFAULT 0,
    "total_earnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATE NOT NULL,

    CONSTRAINT "day_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scanback" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "start_time" DATE NOT NULL,
    "end_time" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "status" "ScanbackStatus" NOT NULL,

    CONSTRAINT "Scanback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day_plans_user_id_date_key" ON "day_plans"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_day_plan_id_route_sequence_key" ON "jobs"("day_plan_id", "route_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "users_lemon_squeezy_customer_id_key" ON "users"("lemon_squeezy_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_lemon_squeezy_subscription_id_key" ON "users"("lemon_squeezy_subscription_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_day_plan_id_fkey" FOREIGN KEY ("day_plan_id") REFERENCES "day_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scanback" ADD CONSTRAINT "Scanback_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
