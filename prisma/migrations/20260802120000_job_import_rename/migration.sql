-- Rename "email import" to the unified "job import" model (email + screenshot).

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('EMAIL', 'SCREENSHOT');

-- AlterTable
ALTER TABLE "email_imports" RENAME TO "job_imports";

-- AlterTable
ALTER TABLE "job_imports" ADD COLUMN "import_type" "ImportType" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN "file_key" TEXT,
ADD COLUMN "file_mimetype" TEXT;

-- Email-only fields become nullable (screenshot imports do not populate them)
ALTER TABLE "job_imports" ALTER COLUMN "resend_message_id" DROP NOT NULL,
ALTER COLUMN "from_address" DROP NOT NULL,
ALTER COLUMN "raw_text" DROP NOT NULL;

-- AlterEnum
ALTER TYPE "ImportStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "ImportStatus" ADD VALUE 'DECLINED';

-- AlterTable (jobs: email_import_id -> import_id)
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_email_import_id_fkey";
ALTER TABLE "jobs" RENAME COLUMN "email_import_id" TO "import_id";

-- AlterTable
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "job_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rename constraints & indexes to match the new table name
ALTER TABLE "job_imports" RENAME CONSTRAINT "email_imports_pkey" TO "job_imports_pkey";
ALTER TABLE "job_imports" RENAME CONSTRAINT "email_imports_user_id_fkey" TO "job_imports_user_id_fkey";
ALTER INDEX "email_imports_resend_message_id_key" RENAME TO "job_imports_resend_message_id_key";
ALTER INDEX "email_imports_user_id_status_idx" RENAME TO "job_imports_user_id_status_idx";
ALTER INDEX "email_imports_user_id_received_at_idx" RENAME TO "job_imports_user_id_received_at_idx";
