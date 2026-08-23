-- DropIndex
DROP INDEX IF EXISTS "invoices_invoice_number_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_user_id_invoice_number_key" ON "invoices"("user_id", "invoice_number");
