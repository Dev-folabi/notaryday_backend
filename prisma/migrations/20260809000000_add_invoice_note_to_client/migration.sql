-- Add editable note_to_client column to invoices.
ALTER TABLE "invoices" ADD COLUMN "note_to_client" TEXT;