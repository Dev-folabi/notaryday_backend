-- AlterTable: add client contact fields + extraction pipeline metadata
ALTER TABLE "job_imports" ADD COLUMN "parsed_client_phone" TEXT,
ADD COLUMN "parsed_client_email" TEXT,
ADD COLUMN "extraction_method" TEXT,
ADD COLUMN "extraction_confidence" DECIMAL(3,2),
ADD COLUMN "ocr_text" TEXT;
