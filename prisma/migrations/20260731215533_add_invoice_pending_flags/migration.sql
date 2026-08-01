-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "email_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pdf_pending" BOOLEAN NOT NULL DEFAULT false;
